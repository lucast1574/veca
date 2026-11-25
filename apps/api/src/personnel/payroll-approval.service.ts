import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { payrollRun, type PayrollInput, type PayrollRun } from "@veca/content";
import { LaborProvider } from "../accounting/labor-provider";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { PersonnelService } from "./personnel.service";
import { PayrollDeductions } from "./payroll-deductions.service";

@Injectable()
export class PayrollApproval {
  constructor(
    private readonly people: PersonnelService,
    private readonly provider: LaborProvider,
    private readonly deductions: PayrollDeductions,
  ) {}

  private selected(run: PayrollRun) {
    return this.people.incidents
      .find({
        issuerRuc: fiscalIssuerRuc,
        period: run.period,
        employeeId: { $in: run.lines.map((line) => line.employeeId) },
        $or: [
          { status: "approved" },
          { status: "authorized", payrollRunId: run.id },
        ],
      })
      .toArray();
  }

  async sync(runId: string, actor: string) {
    const run = await this.deductions.resumePending(runId);
    if (run.status !== "draft") return run;
    const selected = await this.selected(run);
    if (selected.some((row) => row.payrollRunId && row.payrollRunId !== run.id))
      throw new ConflictException(
        "Un descuento ya pertenece a otra planilla. Actualiza los datos.",
      );
    if (selected.every((row) => row.payrollRunId === run.id)) return run;
    return this.deductions.apply(
      run.id,
      run.revision,
      randomUUID(),
      selected.map((row) => String(row._id)),
      actor,
    );
  }

  async create(input: PayrollInput, actor: string) {
    if (
      (await this.provider.runs()).some(
        (run) => run.period === input.period && run.status !== "void",
      )
    )
      throw new ConflictException(
        "Ya existe una planilla para este periodo. Actualiza los datos y continúa desde su borrador.",
      );
    const saved = await this.provider.request("runs", payrollRun, {
      method: "POST",
      data: input,
    });
    try {
      return await this.sync(saved.id, actor);
    } catch {
      throw new ConflictException(
        "El borrador se guardó. Hay descuentos aprobados por actualizar; revísalos en Descuentos al personal antes de aprobar la planilla.",
      );
    }
  }

  async edit(
    id: string,
    input: PayrollInput & { revision: number },
    manual: boolean,
    actor: string,
  ) {
    await this.deductions.edit(id, input, manual);
    return this.sync(id, actor);
  }

  async approve(id: string, revision: number, actor: string) {
    const filter = { _id: new ObjectId(id), issuerRuc: fiscalIssuerRuc };
    let row = await this.people.incidents.findOne(filter);
    if (!row) throw new NotFoundException("Descuento no encontrado.");
    if (row.status !== "authorized" && row.status !== "approved")
      throw new ConflictException(
        "La incidencia debe tener sustento antes de aprobar el descuento.",
      );
    if (
      row.revision !== revision &&
      !(row.status === "approved" && row.revision === revision + 1)
    )
      throw new ConflictException("El descuento cambió. Actualiza los datos.");
    const periodRuns = (await this.provider.runs()).filter(
      (run) => run.period === row!.period && run.status !== "void",
    );
    const runs = periodRuns.filter((run) =>
      run.lines.some((line) => line.employeeId === row!.employeeId),
    );
    if (row.payrollRunId) {
      const run = runs.find((run) => run.id === row!.payrollRunId);
      if (run) return { item: this.people.view(row, runs), applied: true };
      throw new ConflictException(
        "La planilla vinculada cambió. Actualiza los datos.",
      );
    }
    if (periodRuns.some((run) => run.status !== "draft"))
      throw new ConflictException(
        "La planilla del trabajador ya está aprobada o pagada. Revisa el periodo con el encargado de la obra.",
      );
    if (runs.length > 1)
      throw new ConflictException(
        "Hay más de un borrador para el trabajador. Revisa las planillas antes de aprobar el descuento.",
      );
    const draft = runs[0];
    if (draft && row.status === "authorized") {
      const sources = await this.selected(draft);
      const selected = sources.some((source) => source._id.equals(row!._id))
        ? sources
        : [...sources, row];
      const line = draft.lines.find(
        (line) => line.employeeId === row!.employeeId,
      )!;
      const previous = await this.people.incidents
        .find({
          issuerRuc: fiscalIssuerRuc,
          payrollRunId: draft.id,
          employeeId: row.employeeId,
        })
        .toArray();
      const available =
        line.netCents + previous.reduce((sum, source) => sum + source.cents, 0);
      if (
        selected
          .filter((source) => source.employeeId === row!.employeeId)
          .reduce((sum, source) => sum + source.cents, 0) > available
      )
        throw new BadRequestException(
          "El descuento supera el neto disponible del trabajador. Revisa el importe y el periodo antes de aprobarlo.",
        );
    }
    if (row.status === "authorized") {
      const now = new Date().toISOString();
      const saved = await this.people.incidents.findOneAndUpdate(
        {
          ...filter,
          revision,
          status: "authorized",
          claimId: { $exists: false },
          payrollRunId: { $exists: false },
        },
        {
          $set: { status: "approved", approval: { by: actor, at: now } },
          $inc: { revision: 1 },
          $push: { events: { action: "approved", by: actor, at: now } },
        },
        { returnDocument: "after" },
      );
      if (!saved)
        throw new ConflictException(
          "El descuento cambió. Actualiza y vuelve a intentarlo.",
        );
      row = saved;
    }
    if (!draft) return { item: this.people.view(row), applied: false };
    try {
      await this.sync(draft.id, actor);
    } catch {
      throw new ConflictException(
        "El descuento quedó aprobado y su actualización de Planilla está pendiente. Actualiza y pulsa Reintentar actualización.",
      );
    }
    const saved = await this.people.incidents.findOne(filter);
    if (!saved || saved.status === "cancelled")
      throw new ConflictException(
        "La incidencia fue cancelada antes de actualizar la planilla. Actualiza los datos.",
      );
    return { item: this.people.view(saved!), applied: !!saved?.payrollRunId };
  }
}
