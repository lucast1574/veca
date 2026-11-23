import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import {
  accountingTotals,
  COST_KIND_LABELS,
  isDemoLead,
  type AccountingCost,
  type AccountingInvoice,
  type AccountingMargin,
  type AccountingPeriod,
  type CostInput,
  type InvoiceInput,
  type InvoiceStatus,
} from "@veca/content";
import { Database } from "../database/database.module";
import { WarehouseService } from "../inventory/warehouse.service";
import { InventoryService } from "../inventory/inventory.service";
import { CrmRepository } from "../crm/crm.repository";
import { StorageService } from "../media/storage.service";
import { limaDate } from "../dispatch/guide-provider";
import { InvoiceProvider, type FiscalInvoice } from "./invoice-provider";

type InvoiceRecord = Omit<AccountingInvoice, "id" | "canCheck"> & {
  _id: ObjectId;
  externalId?: string;
  attempt?: string;
  creationHash?: string;
  updatedAt: string;
  actor: string;
};
type CostRecord = Omit<AccountingCost, "id" | "proof"> & {
  _id: ObjectId;
  proofKey?: string;
  creationHash?: string;
  actor: string;
};
const issued: InvoiceStatus[] = ["accepted", "observed"];
const pageSize = 25;
const fingerprint = (data: object) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");

function invoiceView({
  _id,
  externalId,
  attempt,
  creationHash,
  actor,
  updatedAt,
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
    canCheck: row.status === "pending" && Boolean(externalId),
  };
}
function costView({
  _id,
  proofKey,
  creationHash,
  actor,
  ...row
}: CostRecord): AccountingCost {
  return { ...row, id: _id.toHexString(), proof: Boolean(proofKey) };
}
const monthBounds = (month: string) => ({
  $gte: month + "-01",
  $lte: month + "-31",
});

@Injectable()
export class AccountingService {
  constructor(
    private readonly db: Database,
    private readonly crm: CrmRepository,
    private readonly fiscal: InvoiceProvider,
    private readonly storage: StorageService,
    private readonly inventory: InventoryService,
    private readonly warehouse: WarehouseService,
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
      .project({ name: 1 })
      .sort({ updatedAt: -1 })
      .limit(600)
      .toArray();
    return rows.map((row) => ({ id: String(row._id), name: String(row.name) }));
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

  async listInvoices(page: number, queue?: "requested" | "collect") {
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
      .find(filter)
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
    return invoiceView(await this.invoiceRecord(id));
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
    await this.work(current.workId);
    if (current.method === "credit" && current.dueDate < issueDate)
      throw new BadRequestException(
        "El vencimiento debe ser a partir de la fecha de emisión.",
      );
    const attempt = randomUUID();
    const locked = await this.changeInvoice(id, version, ["draft"], {
      status: "sending",
      attempt,
      issueDate,
      actor,
    });
    let result: FiscalInvoice;
    try {
      result = await this.fiscal.issue(locked, attempt);
    } catch (error) {
      const rejected = error instanceof BadRequestException;
      return this.changeInvoice(id, locked.version, ["sending"], {
        status: rejected ? "rejected" : "pending",
        observation: rejected
          ? error.message
          : "Envío sin confirmar. Requiere verificación antes de repetirlo.",
      });
    }
    return this.fiscalResult(locked, result, "sending");
  }

  async check(id: string, version: number) {
    const current = await this.invoiceRecord(id);
    if (current.status !== "pending" || !current.externalId)
      throw new ConflictException(
        "Este envío no tiene una consulta disponible.",
      );
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
    return this.fiscalResult(
      invoiceView({ ...current, version }),
      result,
      "pending",
    );
  }

  private fiscalResult(
    invoice: AccountingInvoice,
    result: FiscalInvoice,
    from: InvoiceStatus,
  ) {
    const status: InvoiceStatus =
      result.status === "accepted"
        ? "accepted"
        : ["accepted_with_observations", "observed"].includes(result.status)
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
    return this.changeInvoice(invoice.id, invoice.version, [from], {
      status: mismatched ? "pending" : status,
      externalId: result.id,
      number: result.fullNumber || invoice.number,
      observation: mismatched
        ? "El total fiscal difiere del cálculo local. Requiere revisión."
        : status === "rejected"
          ? "El comprobante requiere corrección."
          : "",
    });
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
        .find({ cancelled: { $ne: true }, requestedOnly: { $ne: true } })
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

  async createCost(data: CostInput, actor: string, id: string) {
    const fields = await this.costFields(data);
    const creationHash = fingerprint(fields);
    const record: CostRecord = {
      ...fields,
      creationHash,
      _id: new ObjectId(id),
      version: 1,
      reviewed: false,
      actor,
    };
    const result = await this.costs.findOneAndUpdate(
      { _id: record._id },
      { $setOnInsert: record },
      { upsert: true, returnDocument: "after" },
    );
    if (!result)
      throw new ServiceUnavailableException("No se pudo guardar el gasto.");
    if (result.creationHash !== creationHash)
      throw new ConflictException(
        "Ya existe un gasto guardado con esta solicitud. Vuelve a la lista para abrirlo.",
      );
    return costView(result);
  }

  async editCost(id: string, version: number, data: CostInput) {
    const fields = await this.costFields(data);
    const row = await this.costs.findOneAndUpdate(
      { _id: new ObjectId(id), version, reviewed: false },
      {
        $set: fields,
        $unset: {
          ...(data.purchaseId ? {} : { purchaseId: "" }),
          ...(data.dispatchId ? {} : { dispatchId: "" }),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!row)
      throw new ConflictException("Este gasto cambió o ya está revisado.");
    return costView(row);
  }

  private async costFields(data: CostInput) {
    if (data.date > limaDate())
      throw new BadRequestException("La fecha del gasto no puede ser futura.");
    if (data.purchaseId) {
      const purchase = await this.warehouse.purchase(data.purchaseId);
      if (
        ["cancelled", "requested"].includes(purchase.status) ||
        data.kind === "materials"
      )
        throw new BadRequestException(
          "Selecciona una compra vigente para el comprobante.",
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
    if (!file || file.buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new BadRequestException(
        "Adjunta un comprobante PDF de hasta 8 MB.",
      );
    const row = await this.costRecord(id);
    if (row.proofKey)
      throw new ConflictException("Este registro ya tiene sustento.");
    const proofKey = `veca/accounting/${row._id}/${randomUUID()}.pdf`;
    await this.storage.put(proofKey, file.buffer, "application/pdf");
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
    if (!row.proofKey)
      throw new NotFoundException("El gasto aún no tiene sustento.");
    return this.storage.get(row.proofKey);
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
    const [sales, costs] = await Promise.all([
      this.invoices
        .aggregate<{
          net: number;
          tax: number;
          count: number;
        }>([
          {
            $match: { issueDate: monthBounds(month), status: { $in: issued } },
          },
          {
            $group: {
              _id: null,
              net: { $sum: "$netCents" },
              tax: { $sum: "$taxCents" },
              count: { $sum: 1 },
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
              pending: { $sum: { $cond: ["$reviewed", 0, 1] } },
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
        "Revisión",
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
        row.reviewed ? "Revisado" : "Pendiente",
      ]),
    ]);
  }

  async margin(workId: string): Promise<AccountingMargin> {
    const work = await this.work(workId);
    if (!work) throw new NotFoundException("Obra no encontrada.");
    await this.inventory.flush();
    const [sales, valuation, plan] = await Promise.all([
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
    ]);
    const firstValuation = valuation?.since
      ? limaDate(new Date(valuation.since))
      : "";
    const costs = await this.costs
      .aggregate<{ costs: number; count: number; manual: number }>([
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
            _id: null,
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
      .next();
    return {
      workId,
      workName: work.name,
      sales: sales?.sales || 0,
      paid: sales?.paid || 0,
      balance: sales?.balance || 0,
      costs: (costs?.costs || 0) + (valuation?.costs || 0),
      costCount: (costs?.count || 0) + (valuation?.count || 0),
      materialCosts: valuation?.costs || 0,
      budgetCents: plan.budgetCents,
      pendingValuation: (valuation?.unvalued || 0) > 0.0001,
      manualMaterialsToReview: costs?.manual || 0,
    };
  }
}
