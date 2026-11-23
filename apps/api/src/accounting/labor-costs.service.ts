import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  laborSourceKey,
  payrollLineCost,
  splitLaborCost,
  type LaborAllocation,
  type LaborAllocationInput,
  type LaborMargin,
  type LaborReceipt,
  type LaborSource,
  type LaborWorkspace,
  type PayrollRun,
} from "@veca/content";
import { MongoServerError } from "mongodb";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { Database } from "../database/database.module";
import { WarehouseService } from "../inventory/warehouse.service";
import { LaborProvider } from "./labor-provider";

type AllocationRecord = LaborAllocation & {
  _id: string;
  issuerRuc: string;
  period: string;
  updatedBy: string;
  updatedAt: string;
};
const view = ({
  source,
  revision,
  rows,
}: LaborAllocation): LaborAllocation => ({ source, revision, rows });

function payrollAmount(run: PayrollRun | undefined, employeeId: string) {
  const line = run?.lines.find((entry) => entry.employeeId === employeeId);
  return line ? payrollLineCost(line) : null;
}

@Injectable()
export class LaborCostsService {
  constructor(
    private readonly database: Database,
    private readonly provider: LaborProvider,
    private readonly warehouse: WarehouseService,
  ) {}

  private get allocations() {
    return this.database.db.collection<AllocationRecord>(
      "accounting_labor_allocations",
    );
  }

  async workspace(period: string): Promise<LaborWorkspace> {
    const [employees, regimes, runs, receipts, allocations] = await Promise.all(
      [
        this.provider.employees(),
        this.provider.regimes(),
        this.provider.runs(),
        this.provider.receipts(),
        this.allocations.find({ issuerRuc: fiscalIssuerRuc, period }).toArray(),
      ],
    );
    return {
      period,
      employees,
      regimes,
      runs: runs.filter((run) => run.period === period),
      receipts: receipts.filter((receipt) =>
        receipt.issueDate.startsWith(period + "-"),
      ),
      allocations: allocations.map(view),
    };
  }

  async receivedReceipt(id: string): Promise<LaborReceipt> {
    const receipt = (await this.provider.receipts()).find(
      (row) => row.id === id,
    );
    if (!receipt)
      throw new NotFoundException("Recibo por honorarios no encontrado.");
    return receipt;
  }

  private async sourceRecord(source: LaborSource) {
    if (source.kind === "fee") {
      const receipt = await this.receivedReceipt(source.id);
      return {
        period: receipt.issueDate.slice(0, 7),
        revision: receipt.revision,
        eligible: receipt.status === "registered",
      };
    }
    const run = (await this.provider.runs()).find(
      (item) => item.id === source.id,
    );
    if (!run || payrollAmount(run, source.employeeId) === null)
      throw new NotFoundException("Trabajador no encontrado en esta planilla.");
    return {
      period: run.period,
      revision: run.revision,
      eligible: run.status === "approved" || run.status === "paid",
    };
  }

  async save(input: LaborAllocationInput, actor: string) {
    const source = await this.sourceRecord(input.source);
    if (!source.eligible)
      throw new ConflictException(
        "El reparto se guarda para planillas aprobadas o pagadas y recibos registrados.",
      );
    if (source.revision !== input.sourceRevision)
      throw new ConflictException(
        "El registro cambió en API SUNAT. Actualiza los datos antes de asignar el costo.",
      );
    await Promise.all(
      input.rows.map(({ workId }) => this.warehouse.work(workId)),
    );
    const id = fiscalIssuerRuc + ":" + laborSourceKey(input.source);
    const data = {
      source: input.source,
      rows: input.rows,
      period: source.period,
      issuerRuc: fiscalIssuerRuc,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };
    const conflict = () =>
      new ConflictException(
        "Otra persona modificó el reparto. Actualiza los datos para continuar.",
      );
    try {
      const record = await this.allocations.findOneAndUpdate(
        { _id: id, revision: input.revision },
        { $set: data, $inc: { revision: 1 } },
        { upsert: input.revision === 0, returnDocument: "after" },
      );
      if (!record) throw conflict();
      return view(record);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw conflict();
      throw error;
    }
  }

  async margin(workId: string): Promise<LaborMargin> {
    const rows = await this.allocations
      .find({
        issuerRuc: fiscalIssuerRuc,
        "rows.workId": workId,
      })
      .toArray();
    if (!rows.length) return { payroll: 0, fees: 0, available: true };
    const kinds = new Set(rows.map(({ source }) => source.kind));
    let runs: PayrollRun[], receipts: LaborReceipt[];
    try {
      [runs, receipts] = await Promise.all([
        kinds.has("payroll") ? this.provider.runs() : [],
        kinds.has("fee") ? this.provider.receipts() : [],
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException)
        return { payroll: 0, fees: 0, available: false };
      throw error;
    }
    const byRun = new Map(runs.map((run) => [run.id, run]));
    const byReceipt = new Map(receipts.map((receipt) => [receipt.id, receipt]));
    let payroll = 0;
    let fees = 0;
    for (const { source, rows: distribution } of rows) {
      if (source.kind === "payroll") {
        const run = byRun.get(source.id);
        if (!run) return { payroll: 0, fees: 0, available: false };
        if (run.status !== "approved" && run.status !== "paid") continue;
        const amount = payrollAmount(run, source.employeeId);
        if (amount === null) return { payroll: 0, fees: 0, available: false };
        payroll +=
          splitLaborCost(amount, distribution).find(
            (row) => row.workId === workId,
          )?.cents ?? 0;
      } else {
        const receipt = byReceipt.get(source.id);
        if (!receipt) return { payroll: 0, fees: 0, available: false };
        if (receipt.status === "registered")
          fees +=
            splitLaborCost(receipt.grossCents, distribution).find(
              (row) => row.workId === workId,
            )?.cents ?? 0;
      }
    }
    return { payroll, fees, available: true };
  }
}
