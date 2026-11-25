import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  costInput,
  type SireIncorporation,
  type SirePurchase,
  type SirePurchasePage,
} from "@veca/content";
import { Database } from "../database/database.module";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { parse } from "../common/validation";
import { AccountingService } from "./accounting.service";
import {
  matchingPurchaseCosts,
  purchaseDocumentKey,
} from "./purchase-document";

export type IncomingPurchase = Omit<
  SirePurchase,
  "id" | "version" | "status" | "costId" | "firstSeenAt"
>;
type Record = IncomingPurchase & {
  _id: ObjectId;
  version: number;
  issuerRuc: string;
  fingerprint: string;
  syncedAt: string;
  firstSeenAt?: string;
};
@Injectable()
export class SirePurchasesService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountingService,
  ) {}
  private get records() {
    return this.db.db.collection<Record>("sire_purchases");
  }
  async pending(period: string, job: string) {
    await this.db.db
      .collection<{ _id: string; job: string }>("sire_purchase_syncs")
      .updateOne({ _id: period }, { $set: { job } }, { upsert: true });
  }
  async remember(period: string, rows: IncomingPurchase[]) {
    const syncedAt = new Date().toISOString();
    // Conflicting duplicate rows remain for manual review, never silently pick one.
    const groups = new Map<string, IncomingPurchase[]>();
    for (const row of rows) {
      const key =
        purchaseDocumentKey(row.taxId, row.reference) ||
        `${row.taxId}:${row.reference}`;
      const id = createHash("sha256")
        .update(`${fiscalIssuerRuc}:${period}:${row.type}:${key}`)
        .digest("hex")
        .slice(0, 24);
      const group = groups.get(id) || [];
      group.push(row);
      groups.set(id, group);
    }
    const operations = [...groups].map(([id, group]) => {
      const row = { ...group[0] };
      if (group.length > 1) {
        row.importable = false;
        row.reason =
          "El comprobante se repite en la propuesta. Revisa el archivo con Contabilidad.";
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(row))
        .digest("hex");
      const fields = {
        ...row,
        reason: row.reason || "",
        period,
        fingerprint,
        syncedAt,
        issuerRuc: fiscalIssuerRuc,
      };
      return {
        updateOne: {
          filter: { _id: new ObjectId(id) },
          update: [
            {
              $set: {
                firstSeenAt: {
                  $ifNull: ["$firstSeenAt", "$syncedAt", syncedAt],
                },
                ...Object.fromEntries(
                  Object.entries(fields).map(([key, value]) => [
                    key,
                    { $literal: value },
                  ]),
                ),
                version: {
                  $cond: [
                    { $eq: ["$fingerprint", fingerprint] },
                    "$version",
                    { $add: [{ $ifNull: ["$version", 0] }, 1] },
                  ],
                },
              },
            },
          ],
          upsert: true,
        },
      };
    });
    for (let i = 0; i < operations.length; i += 500)
      await this.records.bulkWrite(operations.slice(i, i + 500));
    await this.records.updateMany(
      {
        period,
        issuerRuc: fiscalIssuerRuc,
        _id: { $nin: [...groups.keys()].map((id) => new ObjectId(id)) },
      },
      {
        $set: {
          importable: false,
          reason:
            "Ya no aparece en la última consulta de SUNAT. Requiere revisión.",
        },
        $inc: { version: 1 },
      },
    );
    await this.db.db
      .collection<{
        _id: string;
        syncedAt: string;
        count: number;
        failed?: boolean;
        job?: string;
      }>("sire_purchase_syncs")
      .updateOne(
        { _id: period },
        {
          $set: { syncedAt, count: rows.length, failed: false },
          $unset: { job: "" },
        },
        { upsert: true },
      );
  }
  private async view(
    row: Record,
    knownCosts?: Awaited<ReturnType<typeof matchingPurchaseCosts>>,
  ): Promise<SirePurchase> {
    const costs =
      knownCosts ??
      (await matchingPurchaseCosts(this.db.db, row.taxId, row.reference));
    const existing = costs.length === 1 ? costs[0] : undefined;
    const same =
      existing &&
      existing.netCents + existing.taxCents === row.total &&
      row.currency === "PEN" &&
      existing.netCents === row.net &&
      existing.taxCents === row.tax;
    const { _id, issuerRuc, fingerprint, syncedAt, ...data } = row;
    return {
      ...data,
      id: String(_id),
      status:
        costs.length > 1
          ? "manual"
          : existing
            ? same
              ? "registered"
              : "different"
            : row.importable
              ? "pending"
              : "manual",
      ...(existing && { costId: String(existing._id) }),
      ...(costs.length > 1 && {
        reason:
          "Hay varios registros de VECA con este comprobante. Revisa los duplicados.",
      }),
    };
  }
  async list(
    period: string,
    page: number,
    state: "pending" | "all",
    newSince?: string,
  ): Promise<SirePurchasePage> {
    const checkedAt = new Date().toISOString();
    const rows = await this.records
      .find({ period, issuerRuc: fiscalIssuerRuc })
      .sort({ date: -1, _id: 1 })
      .limit(10001)
      .toArray();
    if (rows.length > 10000)
      throw new BadRequestException("El periodo supera 10 000 comprobantes.");
    const items: SirePurchase[] = [];
    const costs = await this.db.db
      .collection("accounting_costs")
      .find({
        supplierRuc: { $in: [...new Set(rows.map((row) => row.taxId))] },
        kind: { $ne: "materials" },
      })
      .project({
        reference: 1,
        supplierRuc: 1,
        netCents: 1,
        taxCents: 1,
        purchaseId: 1,
      })
      .limit(50001)
      .toArray();
    if (costs.length > 50000)
      throw new BadRequestException(
        "Demasiados registros para comparar. Solicita una revisión de Contabilidad.",
      );
    const byKey = new Map<string, typeof costs>();
    for (const cost of costs) {
      const key = purchaseDocumentKey(cost.supplierRuc, cost.reference || "");
      if (key) {
        const group = byKey.get(key) || [];
        group.push(cost);
        byKey.set(key, group);
      }
    }
    for (const row of rows)
      items.push(
        await this.view(
          row,
          byKey.get(purchaseDocumentKey(row.taxId, row.reference) || "") || [],
        ),
      );
    const pending = items.filter((row) => row.status === "pending");
    const filtered =
      state === "pending"
        ? items.filter((row) => row.status !== "registered")
        : items;
    const isNew = (row: SirePurchase) =>
      Boolean(newSince && row.firstSeenAt && row.firstSeenAt > newSince);
    // Bring new purchases into view even when their invoice dates are older.
    if (newSince) filtered.sort((a, b) => Number(isNew(b)) - Number(isNew(a)));
    const sync = await this.db.db
      .collection<{
        _id: string;
        syncedAt: string;
        failed?: boolean;
        job?: string;
      }>("sire_purchase_syncs")
      .findOne({ _id: period });
    return {
      items: filtered.slice((page - 1) * 20, page * 20),
      total: items.length,
      pending: pending.length,
      pendingCents: pending.reduce((sum, row) => sum + row.total, 0),
      registered: items.filter((row) => row.status === "registered").length,
      review: items.filter((row) =>
        ["manual", "different"].includes(row.status),
      ).length,
      hasMore: page * 20 < filtered.length,
      syncedAt: sync?.syncedAt,
      syncFailed: Boolean(sync?.failed),
      syncing: Boolean(sync?.job),
      checkedAt,
      newCount: newSince ? items.filter(isNew).length : 0,
    };
  }
  async detail(id: string) {
    const row = await this.records.findOne({
      _id: new ObjectId(id),
      issuerRuc: fiscalIssuerRuc,
    });
    if (!row)
      throw new NotFoundException("No encontramos esta compra de SUNAT.");
    const item = await this.view(row);
    const purchases = await this.db.db
      .collection("warehouse_purchases")
      .find({
        supplierRuc: row.taxId,
        cancelled: { $ne: true },
        requestedOnly: { $ne: true },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return {
      item,
      purchases: purchases.map((p) => ({
        id: String(p._id),
        label: `${p.supplier} · ${p.reason}`,
        referenceMatch: (p.receipts || []).some(
          (receipt: { reference: string }) =>
            purchaseDocumentKey(row.taxId, receipt.reference) ===
            purchaseDocumentKey(row.taxId, row.reference),
        ),
      })),
    };
  }
  async incorporate(id: string, input: SireIncorporation, actor: string) {
    const { item, purchases } = await this.detail(id);
    if (item.status === "registered") {
      const cost = await this.accounts.cost(item.costId!);
      return {
        costId: item.costId,
        purchaseId: cost.purchaseId,
        alreadyRegistered: true,
      };
    }
    if (item.version !== input.version)
      throw new ConflictException(
        "La propuesta cambió. Cierra y vuelve a revisar la compra.",
      );
    if (item.status !== "pending" || !item.importable)
      throw new ConflictException(
        item.reason ||
          "Resuelve las diferencias antes de incorporar esta compra.",
      );
    if (
      input.destination === "warehouse" &&
      input.purchaseId &&
      !purchases.some((p) => p.id === input.purchaseId)
    )
      throw new BadRequestException(
        "Selecciona una compra vigente del mismo proveedor.",
      );
    const referenced = purchases.filter((p) => p.referenceMatch);
    if (referenced.length > 1)
      throw new ConflictException(
        "La factura aparece en varias compras de almacén. Contabilidad debe revisar su vinculación.",
      );
    if (
      referenced.length === 1 &&
      (input.destination !== "warehouse" ||
        input.purchaseId !== referenced[0].id)
    )
      throw new ConflictException(
        "Esta factura coincide con una compra de almacén. Vincúlala a esa compra para evitar repetir su costo.",
      );
    const data = parse(costInput, {
      description: input.description,
      date: item.date,
      supplier: item.supplier,
      supplierRuc: item.taxId,
      reference: item.reference,
      kind: input.destination === "warehouse" ? "purchase" : input.kind,
      ...(input.purchaseId && { purchaseId: input.purchaseId }),
      netCents: item.net,
      taxCents: item.tax,
      allocations:
        input.destination === "work"
          ? input.allocations || [{ workId: input.workId, cents: item.net }]
          : [],
    });
    const stableId = createHash("sha256")
      .update(
        `sire-cost:${fiscalIssuerRuc}:${purchaseDocumentKey(item.taxId, item.reference)}`,
      )
      .digest("hex")
      .slice(0, 24);
    const cost = await this.accounts.createCost(data, actor, stableId, id);
    return {
      costId: cost.id,
      purchaseId: cost.purchaseId,
      alreadyRegistered: false,
    };
  }
}
