import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import {
  payrollInput,
  payrollLineInput,
  payrollRun,
  type PayrollInput,
  type PayrollRun,
} from "@veca/content";
import { parse } from "../common/validation";
import { Database } from "../database/database.module";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { LaborProvider } from "../accounting/labor-provider";
import { PersonnelService } from "./personnel.service";

type Operation = {
  _id: string;
  issuerRuc: string;
  runId: string;
  revision: number;
  ids: string[];
  previousIds: string[];
  input: PayrollInput;
  hash: string;
  state: "pending" | "done" | "failed";
  actor: string;
  createdAt: string;
};
const inputOf = (run: PayrollRun): PayrollInput => ({
  period: run.period,
  minimumWageCents: run.minimumWageCents,
  lines: run.lines.map((line) =>
    payrollLineInput.parse(
      Object.fromEntries(
        Object.keys(payrollLineInput.shape).map((k) => [
          k,
          line[k as keyof typeof line],
        ]),
      ),
    ),
  ),
});
const matches = (run: PayrollRun, input: PayrollInput) =>
  JSON.stringify(inputOf(run)) === JSON.stringify(input);
@Injectable()
export class PayrollDeductions {
  constructor(
    private readonly db: Database,
    private readonly provider: LaborProvider,
    private readonly people: PersonnelService,
  ) {}
  private get operations() {
    return this.db.db.collection<Operation>("payroll_deduction_operations");
  }
  private async get(id: string) {
    const run = (await this.provider.runs()).find((r) => r.id === id);
    if (!run) throw new NotFoundException("Planilla no encontrada.");
    return run;
  }
  async resumePending(id: string) {
    const operation = await this.operations.findOne({
      issuerRuc: fiscalIssuerRuc,
      runId: id,
      state: "pending",
    });
    return operation ? this.resume(operation) : this.get(id);
  }
  async assertUnlocked(id: string) {
    if (
      await this.operations.findOne({
        issuerRuc: fiscalIssuerRuc,
        runId: id,
        state: "pending",
      })
    )
      throw new ConflictException(
        "Hay una incorporación de descuentos por confirmar. Continúala antes de modificar la planilla.",
      );
  }
  async edit(
    id: string,
    data: PayrollInput & { revision: number },
    manual: boolean,
  ) {
    await this.assertUnlocked(id);
    const current = await this.get(id);
    if (current.status !== "draft" || current.revision !== data.revision)
      throw new ConflictException(
        "Solo se puede editar el borrador vigente de la planilla.",
      );
    const incidents = await this.people.incidents
      .find({ issuerRuc: fiscalIssuerRuc, payrollRunId: id })
      .toArray();
    if (incidents.length && !manual)
      throw new ConflictException(
        "Actualiza el panel para conservar los descuentos al personal.",
      );
    if (
      incidents.some(
        (i) => !data.lines.some((l) => l.employeeId === i.employeeId),
      )
    )
      throw new ConflictException(
        "Este trabajador tiene descuentos aprobados en esta planilla. Anula el borrador antes de preparar uno sin él.",
      );
    const totals = new Map<string, number>();
    for (const i of incidents)
      totals.set(i.employeeId, (totals.get(i.employeeId) || 0) + i.cents);
    const input = {
      ...data,
      lines: data.lines.map((l) => ({
        ...l,
        otherDeductionCents:
          l.otherDeductionCents + (totals.get(l.employeeId) || 0),
      })),
    };
    return this.provider.request(`runs/${id}`, payrollRun, {
      method: "PUT",
      data: input,
    });
  }
  async beforeStatus(id: string, status: string) {
    await this.assertUnlocked(id);
    if (status !== "approved") return;
    const run = await this.get(id);
    if (
      await this.people.incidents.findOne({
        issuerRuc: fiscalIssuerRuc,
        period: run.period,
        employeeId: { $in: run.lines.map((l) => l.employeeId) },
        status: { $in: ["authorized", "approved"] },
        payrollRunId: { $exists: false },
      })
    )
      throw new ConflictException(
        "Revisa los descuentos al personal pendientes de aprobación o de actualizar esta planilla.",
      );
  }
  async afterVoid(id: string) {
    await this.people.incidents.updateMany(
      { issuerRuc: fiscalIssuerRuc, payrollRunId: id },
      { $unset: { payrollRunId: "" } },
    );
  }
  async apply(
    runId: string,
    revision: number,
    operationId: string,
    ids: string[],
    actor: string,
  ) {
    const key = `${fiscalIssuerRuc}:${operationId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify({ runId, revision, ids: [...ids].sort() }))
      .digest("hex");
    let op = await this.operations.findOne({ _id: key });
    if (op) {
      if (op.hash !== hash)
        throw new ConflictException(
          "Esta solicitud ya fue usada con otros datos. Actualiza la planilla.",
        );
      if (op.state === "done") return this.get(runId);
      if (op.state === "failed")
        throw new ConflictException(
          "Vuelve a abrir el formulario para registrar una nueva solicitud.",
        );
      return this.resume(op);
    }
    const run = await this.get(runId);
    if (run.status !== "draft" || run.revision !== revision)
      throw new ConflictException(
        "Actualiza el borrador antes de incorporar descuentos.",
      );
    const [previous, selected] = await Promise.all([
      this.people.incidents
        .find({ issuerRuc: fiscalIssuerRuc, payrollRunId: runId })
        .toArray(),
      this.people.incidents
        .find({
          _id: { $in: ids.map((id) => new ObjectId(id)) },
          issuerRuc: fiscalIssuerRuc,
          $or: [
            { status: "approved" },
            {
              status: { $in: ["authorized", "approved"] },
              payrollRunId: runId,
            },
          ],
          period: run.period,
        })
        .toArray(),
    ]);
    if (
      selected.length !== ids.length ||
      selected.some(
        (i) =>
          !run.lines.some((l) => l.employeeId === i.employeeId) ||
          (i.payrollRunId && i.payrollRunId !== runId),
      )
    )
      throw new ConflictException(
        "Selecciona descuentos aprobados de este periodo y de los trabajadores incluidos.",
      );
    const sum = (rows: typeof selected, id: string) =>
      rows.filter((r) => r.employeeId === id).reduce((a, r) => a + r.cents, 0);
    const input = parse(payrollInput, {
      ...inputOf(run),
      lines: inputOf(run).lines.map((l) => ({
        ...l,
        otherDeductionCents:
          l.otherDeductionCents -
          sum(previous, l.employeeId) +
          sum(selected, l.employeeId),
      })),
    });
    if (
      input.lines.some((line) => {
        const current = run.lines.find(
          (l) => l.employeeId === line.employeeId,
        )!;
        return (
          current.netCents -
            (line.otherDeductionCents - current.otherDeductionCents) <
          0
        );
      })
    )
      throw new BadRequestException(
        "El descuento supera el neto disponible. Revisa el importe y el periodo con el encargado de la obra.",
      );
    op = {
      _id: key,
      issuerRuc: fiscalIssuerRuc,
      runId,
      revision,
      ids: [...ids].sort(),
      previousIds: previous.map((i) => String(i._id)),
      input,
      hash,
      state: "pending",
      actor,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.operations.insertOne(op);
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new ConflictException(
          "Otra persona está incorporando descuentos. Actualiza la planilla.",
        );
      throw e;
    }
    try {
      for (const id of new Set([...op.ids, ...op.previousIds])) {
        const result = await this.people.incidents.updateOne(
          {
            _id: new ObjectId(id),
            issuerRuc: fiscalIssuerRuc,
            status: { $in: ["authorized", "approved"] },
            $or: [{ claimId: { $exists: false } }, { claimId: key }],
          },
          { $set: { claimId: key } },
        );
        if (!result.matchedCount)
          throw new ConflictException(
            "Una incidencia cambió o está siendo incorporada. Actualiza los datos.",
          );
      }
    } catch (e) {
      await this.fail(op);
      throw e;
    }
    return this.resume(op);
  }
  private async fail(op: Operation) {
    await this.people.incidents.updateMany(
      { issuerRuc: fiscalIssuerRuc, claimId: op._id },
      { $unset: { claimId: "" } },
    );
    await this.operations.updateOne(
      { _id: op._id },
      { $set: { state: "failed" } },
    );
  }
  private async finalize(op: Operation, run: PayrollRun) {
    // Recovering a provider response must not resurrect a source that was cancelled
    // before the original process acquired its claims.
    for (const id of op.ids) {
      const claimed = await this.people.incidents.updateOne(
        {
          _id: new ObjectId(id),
          issuerRuc: fiscalIssuerRuc,
          status: { $in: ["authorized", "approved"] },
          $and: [
            { $or: [{ claimId: { $exists: false } }, { claimId: op._id }] },
            {
              $or: [
                { payrollRunId: { $exists: false } },
                { payrollRunId: run.id },
              ],
            },
          ],
        },
        { $set: { claimId: op._id } },
      );
      if (!claimed.matchedCount) {
        if (run.status === "draft" && run.revision === op.revision)
          await this.fail(op);
        throw new ConflictException(
          "El sustento de una incidencia cambió. Contabilidad debe revisar esta incorporación antes de continuar.",
        );
      }
    }
    await this.people.incidents.updateMany(
      {
        _id: { $in: op.ids.map((id) => new ObjectId(id)) },
        issuerRuc: fiscalIssuerRuc,
        status: { $in: ["authorized", "approved"] },
        claimId: op._id,
      },
      { $set: { payrollRunId: run.id }, $unset: { claimId: "" } },
    );
    await this.people.incidents.updateMany(
      {
        _id: {
          $in: op.previousIds
            .filter((id) => !op.ids.includes(id))
            .map((id) => new ObjectId(id)),
        },
        issuerRuc: fiscalIssuerRuc,
        payrollRunId: run.id,
      },
      { $unset: { payrollRunId: "", claimId: "" } },
    );
    await this.operations.updateOne(
      { _id: op._id },
      { $set: { state: "done" } },
    );
    return run;
  }
  private async resume(op: Operation) {
    const current = await this.get(op.runId);
    if (current.status === "void") {
      await this.fail(op);
      await this.afterVoid(current.id);
      throw new ConflictException(
        "Esta planilla está anulada. Prepara un nuevo borrador.",
      );
    }
    if (matches(current, op.input)) return this.finalize(op, current);
    if (current.status !== "draft" || current.revision !== op.revision)
      throw new ConflictException(
        "La planilla cambió durante la incorporación. Contabilidad debe revisar el registro antes de continuar.",
      );
    for (const id of new Set([...op.ids, ...op.previousIds])) {
      const claimed = await this.people.incidents.updateOne(
        {
          _id: new ObjectId(id),
          issuerRuc: fiscalIssuerRuc,
          status: { $in: ["authorized", "approved"] },
          $or: [{ claimId: { $exists: false } }, { claimId: op._id }],
        },
        { $set: { claimId: op._id } },
      );
      if (!claimed.matchedCount) {
        await this.fail(op);
        throw new ConflictException(
          "Una incidencia cambió antes de incorporarse. Actualiza la planilla.",
        );
      }
    }
    let saved: PayrollRun;
    try {
      saved = await this.provider.request(`runs/${op.runId}`, payrollRun, {
        method: "PUT",
        data: { ...op.input, revision: op.revision },
      });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException)
        await this.fail(op);
      throw e;
    }
    if (!matches(saved, op.input))
      throw new ServiceUnavailableException(
        "La planilla no confirmó los importes. Actualiza los datos antes de continuar.",
      );
    return this.finalize(op, saved);
  }
  async recover(runs: PayrollRun[]) {
    for (const run of runs)
      if (run.status === "void") await this.afterVoid(run.id);
    const pending = await this.operations
      .find({ issuerRuc: fiscalIssuerRuc, state: "pending" })
      .toArray();
    for (const op of pending) {
      const run = runs.find((r) => r.id === op.runId);
      if (run?.status === "void") {
        await this.fail(op);
        continue;
      }
      if (run && matches(run, op.input)) {
        try {
          await this.finalize(op, run);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
        }
      }
    }
    const remaining = await this.operations
      .find({ issuerRuc: fiscalIssuerRuc, state: "pending" })
      .toArray();
    return runs.map((r) => {
      const op = remaining.find((o) => o.runId === r.id);
      return {
        ...r,
        ...(op
          ? {
              deductionPending: {
                operationId: op._id.split(":")[1],
                incidentIds: op.ids,
                revision: op.revision,
              },
            }
          : {}),
      };
    });
  }
}
