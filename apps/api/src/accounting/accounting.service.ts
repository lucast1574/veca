import { readAccountingProof, storeAccountingProof } from "./accounting-proof";
import { latestQuotation } from "../crm/quotation";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ObjectId,
  MongoBulkWriteError,
  MongoServerError,
  type AnyBulkWriteOperation,
  type Filter,
} from "mongodb";
import {
  matchingPurchaseCosts,
  purchaseDocumentKey,
} from "./purchase-document";
import { createHash, randomUUID } from "node:crypto";
import {
  accountingTotals,
  COST_KIND_LABELS,
  invoiceFields,
  invoiceInput,
  isDemoLead,
  type AccountingCost,
  type AccountingInvoice,
  type AccountingMargin,
  type AccountingPeriod,
  type CostInput,
  type InvoiceInput,
  type InvoiceStatus,
  type SireSale,
} from "@veca/content";
import { Database } from "../database/database.module";
import { PurchaseRoutingService } from "./purchase-routing.service";
import { WarehouseService } from "../inventory/warehouse.service";
import { InventoryService } from "../inventory/inventory.service";
import { CrmRepository } from "../crm/crm.repository";
import { StorageService } from "../media/storage.service";
import { limaDate } from "../dispatch/guide-provider";
import { LaborCostsService } from "./labor-costs.service";
import {
  canReplayFiscalAttempt,
  fiscalAttemptScope,
  fiscalIssuerRuc,
  type FiscalAttemptContext,
} from "../common/fiscal-config";
import { InvoiceProvider, type FiscalInvoice } from "./invoice-provider";

type InvoiceRecord = Omit<AccountingInvoice, "id" | "canCheck" | "proof"> & {
  _id: ObjectId;
  externalId?: string;
  fiscalNumberKey?: string;
  attempt?: string;
  attemptContext?: FiscalAttemptContext;
  creationHash?: string;
  updatedAt: string;
  actor: string;
  proofKey?: string;
};
type CostRecord = Omit<AccountingCost, "id" | "proof"> & {
  _id: ObjectId;
  proofKey?: string;
  creationHash?: string;
  actor: string;
  invoiceKey?: string;
  sireSourceId?: string;
  warehouseRoutingPending?: boolean;
};
const issued: InvoiceStatus[] = ["accepted", "observed"];
function fiscalNumberKey(number: string) {
  const match = /^([A-Z0-9]{1,20})\s*-\s*(\d{1,20})$/i.exec(number.trim());
  if (!match) return "";
  const series = match[1].toUpperCase().replace(/^0+(?=.)/, "");
  const serial = match[2].replace(/^0+(?=\d)/, "");
  return `${fiscalIssuerRuc}:${series}-${serial}`;
}
const issuable: InvoiceStatus[] = ["requested", "draft"];
const observed = (status: string) =>
  ["accepted_with_observations", "observed"].includes(status);

function fiscalObservation(result: FiscalInvoice) {
  const response = result.sunat;
  if (observed(result.status))
    return response?.description?.trim().slice(0, 1400) || "";
  if (result.status !== "rejected") return "";
  return [
    ...new Set(
      [
        (response?.errorMessage || response?.description)?.trim(),
        response?.fix?.message.trim(),
      ].filter(Boolean),
    ),
  ]
    .join("\n")
    .slice(0, 1400);
}
const pageSize = 25;
const fingerprint = (data: object) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");

function invoiceView({
  _id,
  externalId,
  fiscalNumberKey: _fiscalNumberKey,
  attempt,
  attemptContext,
  creationHash,
  actor,
  updatedAt,
  proofKey,
  ...row
}: InvoiceRecord): AccountingInvoice {
  const stalled =
    row.status === "sending" && Date.now() - Date.parse(updatedAt) > 45_000;
  return {
    ...row,
    id: _id.toHexString(),
    status: stalled ? "pending" : row.status,
    observation: stalled
      ? "Envío sin confirmar. Requiere verificación antes de repetirlo."
      : row.observation,
    canCheck:
      (row.status === "pending" || stalled) &&
      Boolean(
        externalId ||
        (attempt && row.issueDate && canReplayFiscalAttempt(attemptContext)),
      ),
    proof: Boolean(proofKey),
  };
}
function costView({
  _id,
  proofKey,
  creationHash,
  actor,
  invoiceKey,
  sireSourceId,
  warehouseRoutingPending,
  ...row
}: CostRecord): AccountingCost {
  return { ...row, id: _id.toHexString(), proof: Boolean(proofKey) };
}
const monthBounds = (month: string) => ({
  $gte: month + "-01",
  $lte: month + "-31",
});
function invoicePeriodScope(month: string): Filter<InvoiceRecord> {
  const start = new Date(`${month}-01T00:00:00-05:00`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    $or: [
      { issueDate: monthBounds(month) },
      {
        status: { $nin: issued },
        createdAt: { $gte: start.toISOString(), $lt: end.toISOString() },
        $or: [
          { issueDate: "" },
          { issueDate: { $exists: false } },
          { issueDate: { $type: "null" } },
        ],
      },
    ],
  };
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly db: Database,
    private readonly crm: CrmRepository,
    private readonly fiscal: InvoiceProvider,
    private readonly storage: StorageService,
    private readonly inventory: InventoryService,
    private readonly warehouse: WarehouseService,
    private readonly labor: LaborCostsService,
    private readonly routing: PurchaseRoutingService,
  ) {}

  get enabled() {
    return this.fiscal.enabled;
  }
  private get invoices() {
    return this.db.db.collection<InvoiceRecord>("accounting_invoices");
  }
  private get costs() {
    return this.db.db.collection<CostRecord>("accounting_costs");
  }

  async works() {
    const rows = await this.crm.collection
      .find({
        stage: { $in: ["coordination", "execution", "completed"] },
        name: { $not: /^\[demo\]/i },
        email: { $not: /\.invalid$/i },
      })
      .project({ name: 1, workName: 1 })
      .sort({ updatedAt: -1 })
      .limit(600)
      .toArray();
    return rows.map((row) => ({
      id: String(row._id),
      name: String(row.workName || row.name),
    }));
  }

  private async work(id: string) {
    if (!id) return null;
    const work = await this.crm.get(id);
    if (
      isDemoLead(work) ||
      !["coordination", "execution", "completed"].includes(work.stage)
    )
      throw new BadRequestException(
        "Elige una obra operativa para esta operación contable.",
      );
    return work;
  }

  async importSunatSales(rows: SireSale[]): Promise<SireSale[]> {
    const candidates = new Map<string, SireSale>();
    const conflicting = new Set<string>();
    for (const row of rows) {
      if (row.type !== "01") continue;
      const key = fiscalNumberKey(row.reference);
      if (!key) continue;
      const previous = candidates.get(key);
      if (previous && fingerprint(previous) !== fingerprint(row))
        conflicting.add(key);
      candidates.set(key, row);
    }
    if (!candidates.size) return rows;

    // Include legacy records created before fiscalNumberKey existed.
    const local = new Map<
      string,
      Pick<
        InvoiceRecord,
        | "_id"
        | "customerRuc"
        | "totalCents"
        | "netCents"
        | "taxCents"
        | "status"
      >
    >();
    const existing = this.invoices
      .find({
        status: { $in: [...issued, "pending", "sending"] },
        number: { $exists: true, $ne: "" },
      })
      .project<
        Pick<
          InvoiceRecord,
          | "_id"
          | "number"
          | "customerRuc"
          | "totalCents"
          | "netCents"
          | "taxCents"
          | "status"
        >
      >({
        number: 1,
        customerRuc: 1,
        totalCents: 1,
        netCents: 1,
        taxCents: 1,
        status: 1,
      });
    for await (const invoice of existing) {
      const key = fiscalNumberKey(invoice.number || "");
      if (
        candidates.has(key) &&
        (!local.has(key) || issued.includes(invoice.status))
      )
        local.set(key, invoice);
    }

    const operations: AnyBulkWriteOperation<InvoiceRecord>[] = [];
    const now = new Date().toISOString();
    for (const [key, row] of candidates) {
      if (!row.details || row.review || local.has(key) || conflicting.has(key))
        continue;
      const { issueDate, dueDate, customer, netCents, taxCents } = row.details;
      const record: InvoiceRecord = {
        _id: new ObjectId(),
        fiscalNumberKey: key,
        source: "sunat",
        customer: customer || row.taxId,
        customerRuc: row.taxId,
        issueDate,
        dueDate,
        method: dueDate ? "credit" : "cash",
        number: row.reference,
        netCents,
        taxCents,
        totalCents: row.total,
        paidCents: 0,
        payments: [],
        workName: "",
        workId: "",
        items: [],
        status: "accepted",
        observation: "",
        version: 1,
        actor: "SUNAT",
        createdAt: now,
        updatedAt: now,
      };
      operations.push({
        updateOne: {
          filter: { fiscalNumberKey: key },
          update: { $setOnInsert: record },
          upsert: true,
        },
      });
    }
    if (operations.length) {
      try {
        await this.invoices.bulkWrite(operations, { ordered: false });
      } catch (error) {
        if (!(error instanceof MongoBulkWriteError)) throw error;
        const writes = Array.isArray(error.writeErrors)
          ? error.writeErrors
          : [error.writeErrors];
        if (
          !writes.length ||
          writes.some((entry) => entry.code !== 11000) ||
          error.writeConcernError
        )
          throw error;
      }
      for await (const invoice of this.invoices.find({
        fiscalNumberKey: { $in: [...candidates.keys()] },
      })) {
        local.set(invoice.fiscalNumberKey!, invoice);
      }
    }

    return rows.map((row) => {
      if (row.type !== "01") return row;
      const key = fiscalNumberKey(row.reference);
      const invoice = local.get(key);
      if (conflicting.has(key))
        return {
          ...row,
          review: "SUNAT devolvió datos distintos para el mismo comprobante.",
        };
      if (!invoice) return row;
      if (!issued.includes(invoice.status))
        return {
          ...row,
          review: "La factura ya tiene un envío pendiente en VECA.",
        };
      if (
        invoice.customerRuc !== row.taxId ||
        invoice.totalCents !== row.total ||
        (row.details &&
          (invoice.netCents !== row.details.netCents ||
            invoice.taxCents !== row.details.taxCents))
      )
        return {
          ...row,
          review: "El número ya existe en VECA con otros datos.",
        };
      return { ...row, invoiceId: invoice._id.toHexString() };
    });
  }

  async listInvoices(
    page: number,
    queue?: "requested" | "collect",
    month?: string,
  ) {
    const filter =
      queue === "requested"
        ? { status: "requested" as const }
        : queue === "collect"
          ? {
              status: { $in: issued },
              $expr: { $gt: ["$totalCents", "$paidCents"] },
            }
          : {};
    const rows = await this.invoices
      .find({ ...filter, ...(month ? invoicePeriodScope(month) : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .toArray();
    return {
      items: rows.slice(0, pageSize).map(invoiceView),
      hasMore: rows.length > pageSize,
    };
  }

  async invoice(id: string) {
    const row = await this.invoiceRecord(id);
    if (
      row.externalId &&
      this.enabled &&
      (row.status === "observed" || row.status === "rejected") &&
      (!row.observation ||
        row.observation === "El comprobante requiere corrección.")
    ) {
      const result = await this.fiscal
        .status(row.externalId, AbortSignal.timeout(4_000))
        .catch(() => null);
      if (
        result?.id === row.externalId &&
        (row.status === "observed"
          ? observed(result.status)
          : result.status === "rejected")
      ) {
        const observation = fiscalObservation(result);
        if (observation) return invoiceView({ ...row, observation });
      }
    }
    return invoiceView(row);
  }

  async requestedInvoice(workId: string) {
    const work = await this.work(workId);
    const existing = await this.invoices.findOne({
      workId: work!._id.toHexString(),
      status: "requested",
    });
    return { requested: Boolean(existing) };
  }

  async requestInvoice(workId: string, actor: string) {
    const work = await this.work(workId);
    const now = new Date().toISOString();
    const record: InvoiceRecord = {
      _id: new ObjectId(),
      workId: work!._id.toHexString(),
      workName: work!.name,
      customer: work!.name,
      customerRuc: "",
      method: "cash",
      dueDate: "",
      items: [],
      version: 1,
      status: "requested",
      createdAt: now,
      updatedAt: now,
      issueDate: "",
      number: "",
      observation: "",
      netCents: 0,
      taxCents: 0,
      totalCents: 0,
      paidCents: 0,
      payments: [],
      actor,
    };
    await this.invoices.updateOne(
      { workId: record.workId, status: "requested" },
      { $setOnInsert: record },
      { upsert: true },
    );
    return { requested: true };
  }

  async createInvoice(data: InvoiceInput, actor: string, id: string) {
    const work = await this.work(data.workId);
    const creationHash = fingerprint(data);
    const now = new Date().toISOString();
    const record: InvoiceRecord = {
      ...data,
      creationHash,
      workId: work?._id.toHexString() || "",
      _id: new ObjectId(id),
      workName: work?.name || "",
      createdAt: now,
      updatedAt: now,
      issueDate: "",
      version: 1,
      status: "draft",
      number: "",
      observation: "",
      paidCents: 0,
      payments: [],
      ...accountingTotals(data.items),
      actor,
    };
    const draft = await this.invoices.findOneAndUpdate(
      { _id: record._id },
      { $setOnInsert: record },
      { upsert: true, returnDocument: "after" },
    );
    if (!draft)
      throw new ServiceUnavailableException("No se pudo guardar la factura.");
    if (draft.creationHash !== creationHash)
      throw new ConflictException(
        "Ya existe una factura guardada con esta solicitud. Vuelve a la lista para abrirla.",
      );
    return invoiceView(draft);
  }

  async editInvoice(id: string, version: number, data: InvoiceInput) {
    const work = await this.work(data.workId);
    return this.changeInvoice(id, version, ["requested", "draft", "rejected"], {
      ...data,
      workId: work?._id.toHexString() || "",
      workName: work?.name || "",
      ...accountingTotals(data.items),
      status: "draft",
      externalId: "",
      number: "",
      observation: "",
    });
  }

  async issue(id: string, version: number, actor: string) {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        "La emisión electrónica está pendiente de configuración.",
      );
    const issueDate = limaDate();
    const current = await this.invoiceRecord(id);
    if (!issuable.includes(current.status) || current.version !== version)
      throw new ConflictException(
        "La factura cambió. Vuelve a abrirla para continuar.",
      );
    if (!invoiceInput.safeParse(invoiceFields(current)).success)
      throw new BadRequestException(
        "Completa el cliente, RUC, conceptos y datos de pago antes de emitir.",
      );
    await this.work(current.workId);
    if (current.method === "credit" && current.dueDate < issueDate)
      throw new BadRequestException(
        "El vencimiento debe ser a partir de la fecha de emisión.",
      );
    const attempt = randomUUID();
    const locked = await this.changeInvoice(id, version, issuable, {
      status: "sending",
      attempt,
      attemptContext: {
        startedAt: new Date().toISOString(),
        scope: fiscalAttemptScope,
      },
      issueDate,
      actor,
    });
    return this.sendInvoice(locked, attempt);
  }

  private async sendInvoice(
    invoice: AccountingInvoice,
    attempt: string,
    recovering = false,
  ) {
    let result: FiscalInvoice;
    try {
      result = await this.fiscal.issue(invoice, attempt);
    } catch (error) {
      const rejected = !recovering && error instanceof BadRequestException;
      return this.changeInvoice(invoice.id, invoice.version, ["sending"], {
        status: rejected ? "rejected" : "pending",
        observation: rejected
          ? error.message
          : "Envío sin confirmar. Requiere verificación antes de repetirlo.",
      });
    }
    return this.fiscalResult(invoice, result, "sending");
  }

  async check(id: string, version: number) {
    const current = await this.invoiceRecord(id);
    const invoice = invoiceView(current);
    if (!invoice.canCheck || current.version !== version)
      throw new ConflictException(
        "Este envío no tiene una consulta disponible.",
      );
    if (!current.externalId) {
      if (!current.attempt)
        throw new ConflictException(
          "Este envío no se puede recuperar desde el panel.",
        );
      const locked = await this.changeInvoice(id, version, [current.status], {
        status: "sending",
      });
      return this.sendInvoice(locked, current.attempt, true);
    }
    let result: FiscalInvoice;
    try {
      result = await this.fiscal.status(current.externalId);
    } catch {
      throw new ServiceUnavailableException(
        "No se pudo actualizar el estado fiscal.",
      );
    }
    if (result.id !== current.externalId)
      throw new ConflictException("La consulta no corresponde a esta factura.");
    return this.fiscalResult(invoice, result, current.status);
  }

  private async fiscalResult(
    invoice: AccountingInvoice,
    result: FiscalInvoice,
    from: InvoiceStatus,
  ) {
    const status: InvoiceStatus =
      result.status === "accepted"
        ? "accepted"
        : observed(result.status)
          ? "observed"
          : result.status === "rejected"
            ? "rejected"
            : "pending";
    const providerTotal =
      result.total == null ? null : Math.round(result.total * 100);
    const mismatched =
      issued.includes(status) &&
      (providerTotal !== invoice.totalCents ||
        !(result.fullNumber || invoice.number));
    const number = result.fullNumber || invoice.number;
    const key =
      !mismatched && issued.includes(status) ? fiscalNumberKey(number) : "";
    try {
      return await this.changeInvoice(invoice.id, invoice.version, [from], {
        status: mismatched ? "pending" : status,
        externalId: result.id,
        number,
        ...(key && { fiscalNumberKey: key }),
        observation: mismatched
          ? "El total fiscal difiere del cálculo local. Requiere revisión."
          : fiscalObservation(result),
      });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000 || !key)
        throw error;
      return this.changeInvoice(invoice.id, invoice.version, [from], {
        status: "pending",
        externalId: result.id,
        number,
        observation:
          "El número fiscal ya está registrado en VECA. Revisa ambos registros antes de continuar.",
      });
    }
  }

  async payment(
    id: string,
    version: number,
    payment: AccountingInvoice["payments"][number],
  ) {
    if (payment.date > limaDate())
      throw new BadRequestException("La fecha del cobro no puede ser futura.");
    const current = await this.invoiceRecord(id);
    if (payment.date < current.issueDate)
      throw new BadRequestException(
        "La fecha del cobro no puede ser anterior a la factura.",
      );
    if (payment.cents > current.totalCents - current.paidCents)
      throw new BadRequestException("El cobro supera el saldo pendiente.");
    return this.changeInvoice(id, version, issued, {
      payments: [...current.payments, payment],
      paidCents: current.paidCents + payment.cents,
    });
  }

  async invoiceFile(id: string, type: "pdf" | "xml" | "cdr") {
    const current = await this.invoiceRecord(id);
    if (!current.externalId || !issued.includes(current.status))
      throw new NotFoundException("El archivo fiscal aún no está disponible.");
    try {
      return await this.fiscal.file(current.externalId, type);
    } catch {
      throw new ServiceUnavailableException(
        "El archivo fiscal aún no está disponible.",
      );
    }
  }

  private async invoiceRecord(id: string) {
    const row = await this.invoices.findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException("Factura no encontrada.");
    return row;
  }

  private async changeInvoice(
    id: string,
    version: number,
    statuses: InvoiceStatus[],
    values: Partial<InvoiceRecord>,
  ) {
    const next = await this.invoices.findOneAndUpdate(
      { _id: new ObjectId(id), version, status: { $in: statuses } },
      {
        $set: { ...values, updatedAt: new Date().toISOString() },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!next)
      throw new ConflictException(
        "La factura cambió. Vuelve a abrirla para continuar.",
      );
    return invoiceView(next);
  }

  async costOrigins() {
    const [purchases, dispatches] = await Promise.all([
      this.db.db
        .collection("warehouse_purchases")
        .find({
          cancelled: { $ne: true },
          $or: [
            { requestedOnly: { $ne: true } },
            { "invoiceSource.costId": { $exists: true } },
          ],
        })
        .project({ supplier: 1, createdAt: 1, workName: 1 })
        .sort({ _id: -1 })
        .limit(300)
        .toArray(),
      this.db.db
        .collection("dispatches")
        .find({ demo: { $ne: true } })
        .project({ guideNumber: 1, workName: 1, "data.transferAt": 1 })
        .sort({ _id: -1 })
        .limit(300)
        .toArray(),
    ]);
    return {
      purchases: purchases.map((row) => ({
        value: String(row._id),
        label: [row.supplier, row.workName, row.createdAt?.slice(0, 10)]
          .filter(Boolean)
          .join(" · "),
      })),
      dispatches: dispatches.map((row) => ({
        value: String(row._id),
        label: [
          row.guideNumber,
          row.workName,
          row.data?.transferAt?.slice(0, 10),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  }

  async listCosts(page: number, month?: string, purchaseId?: string) {
    const rows = await this.costs
      .find({
        ...(month ? { date: monthBounds(month) } : {}),
        ...(purchaseId ? { purchaseId } : {}),
      })
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .toArray();
    return {
      items: rows.slice(0, pageSize).map(costView),
      hasMore: rows.length > pageSize,
    };
  }

  async cost(id: string) {
    return costView(await this.costRecord(id));
  }

  async createCost(
    data: CostInput,
    actor: string,
    id: string,
    sireSourceId?: string,
  ) {
    const fields = await this.costFields(data, id);
    await this.checkCostDuplicate(data, id);
    const creationHash = fingerprint(fields);
    const record: CostRecord = {
      ...fields,
      creationHash,
      _id: new ObjectId(id),
      version: 1,
      reviewed: false,
      actor,
      ...(data.kind !== "materials" &&
      purchaseDocumentKey(data.supplierRuc, data.reference)
        ? { invoiceKey: purchaseDocumentKey(data.supplierRuc, data.reference) }
        : {}),
      ...(sireSourceId && { sireSourceId }),
      ...(data.kind === "purchase" && { warehouseRoutingPending: true }),
    };
    const result = await this.costs
      .findOneAndUpdate(
        { _id: record._id },
        { $setOnInsert: record },
        { upsert: true, returnDocument: "after" },
      )
      .catch((error: unknown) => this.costWriteError(error));
    if (!result)
      throw new ServiceUnavailableException("No se pudo guardar el gasto.");
    if (result.creationHash !== creationHash)
      throw new ConflictException(
        "Ya existe un gasto guardado con esta solicitud. Vuelve a la lista para abrirlo.",
      );
    await this.routing
      .ensure(id)
      .catch(() =>
        new Logger(AccountingService.name).warn(
          "La derivación a Almacén se reintentará automáticamente.",
        ),
      );
    return costView(await this.costRecord(id));
  }

  async editCost(id: string, version: number, data: CostInput) {
    const current = await this.costRecord(id);
    if (current.warehouseRoutingPending)
      throw new ConflictException(
        "La compra está siendo derivada a Almacén. Vuelve a abrirla en unos momentos antes de editarla.",
      );
    if (current.sireSourceId && data.kind === "materials")
      throw new BadRequestException(
        "Una factura de SUNAT no se convierte en un consumo de stock.",
      );
    if (
      current.sireSourceId &&
      ["reference", "supplierRuc", "date", "netCents", "taxCents"].some(
        (key) =>
          current[key as keyof CostInput] !== data[key as keyof CostInput],
      )
    )
      throw new BadRequestException(
        "Los datos del comprobante de SUNAT se conservan. Puedes editar su clasificación y asignación.",
      );
    await this.checkCostDuplicate(data, id);
    if (
      current.kind === "purchase" &&
      current.purchaseId &&
      (data.kind !== "purchase" || data.purchaseId !== current.purchaseId) &&
      (await this.warehouse.purchase(current.purchaseId)).status !== "cancelled"
    )
      throw new ConflictException(
        "La compra ya está en Almacén. Coordina su cancelación antes de cambiar su destino o quitar el vínculo.",
      );
    const fields = await this.costFields(data, id);
    const invoiceKey =
      data.kind !== "materials"
        ? purchaseDocumentKey(data.supplierRuc, data.reference)
        : undefined;
    const row = await this.costs
      .findOneAndUpdate(
        { _id: new ObjectId(id), version, reviewed: false },
        {
          $set: {
            ...fields,
            ...(invoiceKey && { invoiceKey }),
            ...(data.kind === "purchase" &&
            (current.kind !== "purchase" || !current.purchaseId)
              ? { warehouseRoutingPending: true }
              : {}),
          },
          $unset: {
            ...(!invoiceKey ? { invoiceKey: "" } : {}),
            ...(data.purchaseId ? {} : { purchaseId: "" }),
            ...(data.dispatchId ? {} : { dispatchId: "" }),
          },
          $inc: { version: 1 },
        },
        { returnDocument: "after" },
      )
      .catch((error: unknown) => this.costWriteError(error));
    if (!row)
      throw new ConflictException("Este gasto cambió o ya está revisado.");
    await this.routing
      .ensure(id)
      .catch(() =>
        new Logger(AccountingService.name).warn(
          "La derivación a Almacén se reintentará automáticamente.",
        ),
      );
    return costView(await this.costRecord(id));
  }

  private costWriteError(error: unknown): never {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new ConflictException(
        "Este comprobante ya está registrado en Compras y gastos. Recarga la bandeja para abrirlo.",
      );
    throw error;
  }
  private async checkCostDuplicate(data: CostInput, id: string) {
    if (data.kind === "materials") return;
    const rows = await matchingPurchaseCosts(
      this.db.db,
      data.supplierRuc,
      data.reference,
    );
    if (rows.some((row) => String(row._id) !== id.toLowerCase()))
      throw new ConflictException(
        "Este comprobante ya está registrado. Vincula el registro existente en lugar de crear otro.",
      );
  }

  private async costFields(data: CostInput, id: string) {
    if (data.date > limaDate())
      throw new BadRequestException("La fecha del gasto no puede ser futura.");
    if (data.purchaseId) {
      const purchase = await this.warehouse.purchase(data.purchaseId);
      if (
        purchase.status === "cancelled" ||
        (purchase.status === "requested" &&
          purchase.invoiceSource?.costId !== id) ||
        data.kind === "materials"
      )
        throw new BadRequestException(
          "Selecciona una compra vigente para el comprobante.",
        );
    }
    if (data.purchaseId) {
      const purchase = await this.warehouse.purchase(data.purchaseId);
      if (
        purchase.invoiceSource &&
        (purchase.invoiceSource.costId !== id ||
          purchase.supplierRuc !== data.supplierRuc ||
          purchase.invoiceSource.reference !== data.reference ||
          purchase.invoiceSource.netCents !== data.netCents ||
          purchase.invoiceSource.taxCents !== data.taxCents)
      )
        throw new BadRequestException(
          "Conserva los datos de la factura vinculada a Almacén.",
        );
    }
    if (data.dispatchId) {
      const dispatch = await this.db.db
        .collection("dispatches")
        .findOne({ _id: new ObjectId(data.dispatchId), demo: { $ne: true } });
      if (
        !dispatch ||
        (data.allocations.length &&
          !data.allocations.some(
            (row) => row.workId.toLowerCase() === dispatch.leadId,
          ))
      )
        throw new BadRequestException(
          "El despacho debe corresponder a una de las obras asignadas.",
        );
    }
    const allocations = await Promise.all(
      data.allocations.map(async ({ workId, cents }) => {
        const work = await this.work(workId);
        return { workId: work!._id.toHexString(), cents };
      }),
    );
    return { ...data, allocations };
  }

  async attach(id: string, file: Express.Multer.File | undefined) {
    const row = await this.costRecord(id);
    if (row.proofKey)
      throw new ConflictException("Este registro ya tiene sustento.");
    const proofKey = await storeAccountingProof(
      this.storage,
      `veca/accounting/${row._id}`,
      file,
    );
    const result = await this.costs.findOneAndUpdate(
      { _id: row._id, version: row.version, proofKey: { $exists: false } },
      { $set: { proofKey }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (!result) {
      await this.storage.remove(proofKey).catch(() => {});
      throw new ConflictException(
        "El gasto cambió. Revisa el sustento registrado.",
      );
    }
    return costView(result);
  }

  async proof(id: string) {
    const row = await this.costRecord(id);
    return readAccountingProof(this.storage, row.proofKey);
  }

  async attachInvoiceProof(id: string, file: Express.Multer.File | undefined) {
    const row = await this.invoiceRecord(id);
    if (row.proofKey)
      throw new ConflictException("Esta factura ya tiene sustento.");
    const proofKey = await storeAccountingProof(
      this.storage,
      `veca/accounting/invoices/${row._id}`,
      file,
    );
    // The internal attachment does not change the fiscal version of the invoice.
    const result = await this.invoices.findOneAndUpdate(
      { _id: row._id, proofKey: { $exists: false } },
      { $set: { proofKey } },
      { returnDocument: "after" },
    );
    if (!result) {
      await this.storage.remove(proofKey).catch(() => {});
      throw new ConflictException(
        "La factura cambió. Revisa el sustento registrado.",
      );
    }
    return invoiceView(result);
  }

  async invoiceProof(id: string) {
    return readAccountingProof(
      this.storage,
      (await this.invoiceRecord(id)).proofKey,
    );
  }

  async reviewCost(id: string, version: number) {
    const row = await this.costRecord(id);
    if (!row.proofKey)
      throw new BadRequestException(
        "Adjunta el sustento antes de revisar el gasto.",
      );
    const next = await this.costs.findOneAndUpdate(
      { _id: row._id, version },
      { $set: { reviewed: true }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (!next)
      throw new ConflictException("El gasto cambió. Vuelve a cargarlo.");
    return costView(next);
  }

  private async costRecord(id: string) {
    const row = await this.costs.findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException("Gasto no encontrado.");
    return row;
  }

  async period(month: string): Promise<AccountingPeriod> {
    const isIssued = { $in: ["$status", issued] };
    const [sales, costs] = await Promise.all([
      this.invoices
        .aggregate<{
          net: number;
          tax: number;
          count: number;
          toIssue: number;
          toConfirm: number;
          toCorrect: number;
        }>([
          {
            $match: invoicePeriodScope(month),
          },
          {
            $group: {
              _id: null,
              net: { $sum: { $cond: [isIssued, "$netCents", 0] } },
              tax: { $sum: { $cond: [isIssued, "$taxCents", 0] } },
              count: { $sum: { $cond: [isIssued, 1, 0] } },
              toIssue: {
                $sum: {
                  $cond: [{ $in: ["$status", ["requested", "draft"]] }, 1, 0],
                },
              },
              toConfirm: {
                $sum: {
                  $cond: [{ $in: ["$status", ["sending", "pending"]] }, 1, 0],
                },
              },
              toCorrect: {
                $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
              },
            },
          },
        ])
        .next(),
      this.costs
        .aggregate<{
          net: number;
          tax: number;
          count: number;
          pending: number;
        }>([
          { $match: { date: monthBounds(month), kind: { $ne: "materials" } } },
          {
            $group: {
              _id: null,
              net: { $sum: "$netCents" },
              tax: { $sum: "$taxCents" },
              count: { $sum: 1 },
              pending: {
                $sum: {
                  $cond: [{ $eq: [{ $ifNull: ["$proofKey", ""] }, ""] }, 1, 0],
                },
              },
            },
          },
        ])
        .next(),
    ]);
    return {
      salesNet: sales?.net || 0,
      salesTax: sales?.tax || 0,
      salesCount: sales?.count || 0,
      costsNet: costs?.net || 0,
      costsTax: costs?.tax || 0,
      costsCount: costs?.count || 0,
      pendingCosts: costs?.pending || 0,
      pendingInvoices: {
        toIssue: sales?.toIssue || 0,
        toConfirm: sales?.toConfirm || 0,
        toCorrect: sales?.toCorrect || 0,
      },
    };
  }

  async exportPeriod(month: string, type: "sales" | "costs") {
    const limit = 10_000;
    const excel = (value: string | number) => {
      const plain = String(value);
      const safe = /^[\s]*[=+@-]/.test(plain) ? "'" + plain : plain;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const csv = (rows: (string | number)[][]) =>
      "\uFEFF" + rows.map((row) => row.map(excel).join(",")).join("\r\n");
    const soles = (value: number) => (value / 100).toFixed(2);
    if (type === "sales") {
      const rows = await this.invoices
        .find({ issueDate: monthBounds(month), status: { $in: issued } })
        .sort({ issueDate: 1, _id: 1 })
        .limit(limit + 1)
        .toArray();
      if (rows.length > limit)
        throw new BadRequestException(
          "El periodo excede el límite de exportación.",
        );
      return csv([
        [
          "Fecha",
          "Factura",
          "RUC",
          "Cliente",
          "Obra",
          "Neto",
          "IGV",
          "Total",
          "Cobrado",
        ],
        ...rows.map((row) => [
          row.issueDate,
          row.number,
          row.customerRuc,
          row.customer,
          row.workName,
          soles(row.netCents),
          soles(row.taxCents),
          soles(row.totalCents),
          soles(row.paidCents),
        ]),
      ]);
    }
    const rows = await this.costs
      .find({ date: monthBounds(month), kind: { $ne: "materials" } })
      .sort({ date: 1, _id: 1 })
      .limit(limit + 1)
      .toArray();
    if (rows.length > limit)
      throw new BadRequestException(
        "El periodo excede el límite de exportación.",
      );
    return csv([
      [
        "Fecha",
        "Concepto",
        "Categoría",
        "Proveedor",
        "RUC",
        "Comprobante",
        "Neto",
        "IGV",
        "Sustento",
      ],
      ...rows.map((row) => [
        row.date,
        row.description,
        COST_KIND_LABELS[row.kind],
        row.supplier,
        row.supplierRuc,
        row.reference,
        soles(row.netCents),
        soles(row.taxCents),
        row.proofKey ? "Con sustento" : "Falta sustento",
      ]),
    ]);
  }

  async margin(workId: string): Promise<AccountingMargin> {
    const work = await this.work(workId);
    if (!work) throw new NotFoundException("Obra no encontrada.");
    await this.inventory.flush();
    const [sales, valuation, plan, labor, quotation] = await Promise.all([
      this.invoices
        .aggregate<{
          sales: number;
          paid: number;
          balance: number;
        }>([
          { $match: { workId, status: { $in: issued } } },
          {
            $group: {
              _id: null,
              sales: { $sum: "$netCents" },
              paid: { $sum: "$paidCents" },
              balance: { $sum: { $subtract: ["$totalCents", "$paidCents"] } },
            },
          },
        ])
        .next(),
      this.inventory.ledger
        .aggregate<{
          costs: number;
          count: number;
          since: string | null;
          unvalued: number;
        }>([
          {
            $match: {
              leadId: workId,
              kind: { $in: ["consumption", "return"] },
            },
          },
          {
            $group: {
              _id: null,
              costs: { $sum: "$costCents" },
              count: {
                $sum: { $cond: [{ $gt: ["$valuedQuantity", 0] }, 1, 0] },
              },
              since: {
                $min: { $cond: [{ $gt: ["$valuedQuantity", 0] }, "$at", null] },
              },
              unvalued: {
                $sum: {
                  $ifNull: [
                    "$unvaluedQuantity",
                    {
                      $cond: [
                        { $eq: ["$kind", "consumption"] },
                        "$quantity",
                        { $multiply: ["$quantity", -1] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ])
        .next(),
      this.warehouse.plan(workId),
      this.labor.margin(workId),
      latestQuotation(this.db.db, workId),
    ]);
    const firstValuation = valuation?.since
      ? limaDate(new Date(valuation.since))
      : "";
    const categories = await this.costs
      .aggregate<{
        _id: CostInput["kind"];
        costs: number;
        count: number;
        manual: number;
      }>([
        { $match: { kind: { $ne: "purchase" }, "allocations.workId": workId } },
        { $unwind: "$allocations" },
        { $match: { "allocations.workId": workId } },
        {
          $set: {
            duplicateRisk: firstValuation
              ? {
                  $and: [
                    { $eq: ["$kind", "materials"] },
                    { $gte: ["$date", firstValuation] },
                  ],
                }
              : false,
          },
        },
        {
          $group: {
            _id: "$kind",
            costs: {
              $sum: { $cond: ["$duplicateRisk", 0, "$allocations.cents"] },
            },
            count: { $sum: { $cond: ["$duplicateRisk", 0, 1] } },
            manual: {
              $sum: { $cond: ["$duplicateRisk", "$allocations.cents", 0] },
            },
          },
        },
      ])
      .toArray();
    const costs = categories.reduce(
      (total, row) => ({
        costs: total.costs + row.costs,
        count: total.count + row.count,
        manual: total.manual + row.manual,
      }),
      { costs: 0, count: 0, manual: 0 },
    );
    const costBreakdown: AccountingMargin["costBreakdown"] = [
      {
        kind: "materials",
        cents:
          (valuation?.costs || 0) +
          (categories.find((row) => row._id === "materials")?.costs || 0),
      },
      { kind: "payroll", cents: labor.payroll },
      { kind: "fees", cents: labor.fees },
      ...categories
        .filter((row) => row._id !== "materials" && row._id !== "purchase")
        .map((row) => ({
          kind: row._id as Exclude<CostInput["kind"], "purchase">,
          cents: row.costs,
        })),
    ];
    return {
      workId,
      workName: work.workName || work.name,
      sales: sales?.sales || 0,
      paid: sales?.paid || 0,
      balance: sales?.balance || 0,
      costs:
        (costs?.costs || 0) +
        (valuation?.costs || 0) +
        labor.payroll +
        labor.fees,
      labor,
      costCount: (costs?.count || 0) + (valuation?.count || 0),
      materialCosts: valuation?.costs || 0,
      costBreakdown,
      budgetCents: quotation?.costBudgetCents ?? plan.budgetCents,
      ...(quotation ? { quotation } : {}),
      pendingValuation: (valuation?.unvalued || 0) > 0.0001,
      manualMaterialsToReview: costs?.manual || 0,
    };
  }
}
