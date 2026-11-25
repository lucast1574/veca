import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type { CostInput, ManualCostCheck } from "@veca/content";
import { Database } from "../database/database.module";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { limaDate } from "../dispatch/guide-provider";
import {
  matchingPurchaseCosts,
  purchaseDocumentKey,
} from "./purchase-document";
import { SireService } from "./sire.service";

@Injectable()
export class ManualCostCheckService {
  constructor(
    private readonly db: Database,
    private readonly sire: SireService,
  ) {}
  async check(data: CostInput): Promise<ManualCostCheck> {
    if (data.date > limaDate())
      throw new BadRequestException("La fecha del gasto no puede ser futura.");
    const key = purchaseDocumentKey(data.supplierRuc, data.reference);
    if (data.kind === "materials" || !key) return { status: "clear" };
    const costs = await matchingPurchaseCosts(
      this.db.db,
      data.supplierRuc,
      data.reference,
    );
    if (costs.length > 1)
      throw new ConflictException(
        "Hay varios registros con esta factura. Contabilidad debe revisar los duplicados antes de continuar.",
      );
    if (costs.length)
      return { status: "registered", costId: String(costs[0]._id) };
    const cached = async (): Promise<ManualCostCheck | undefined> => {
      const rows = await this.db.db
        .collection("sire_purchases")
        .find({ taxId: data.supplierRuc, issuerRuc: fiscalIssuerRuc })
        .sort({ period: -1 })
        .limit(10001)
        .toArray();
      if (rows.length > 10000)
        throw new ConflictException(
          "Hay demasiados comprobantes de este proveedor para comprobarlos automáticamente. Contabilidad debe revisar la factura.",
        );
      const row = rows.find(
        (row) => purchaseDocumentKey(row.taxId, row.reference) === key,
      );
      if (row)
        return {
          status: "found",
          purchaseId: String(row._id),
          period: row.period,
        };
    };
    const found = await cached();
    if (found) return found;
    // A purchase can be proposed in its issue month or the current period.
    for (const period of new Set([
      data.date.slice(0, 7),
      limaDate().slice(0, 7),
    ])) {
      const sync = await this.db.db
        .collection<{
          _id: string;
          syncedAt?: string;
          job?: string;
          failed?: boolean;
        }>("sire_purchase_syncs")
        .findOne({ _id: period });
      if (
        sync?.syncedAt &&
        !sync.failed &&
        !sync.job &&
        Date.now() - Date.parse(sync.syncedAt) < 30_000
      )
        continue;
      const next = await this.sire.automatic(period, "purchases", sync?.job);
      if (next.status === "pending") return { status: "pending" };
      const fresh = await cached();
      if (fresh) return fresh;
    }
    return (await cached()) || { status: "clear" };
  }
}
