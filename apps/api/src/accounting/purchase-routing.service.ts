import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import type { CostInput } from "@veca/content";
import { Database } from "../database/database.module";
import { WarehouseService } from "../inventory/warehouse.service";
import { Notifications } from "../notifications/notifications.service";
type RoutingCost = CostInput & {
  _id: ObjectId;
  actor: string;
  warehouseRoutingPending?: boolean;
};
@Injectable()
export class PurchaseRoutingService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(PurchaseRoutingService.name);
  constructor(
    private readonly db: Database,
    private readonly warehouse: WarehouseService,
    private readonly notices: Notifications,
  ) {}
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.recover(), 30_000);
    this.timer.unref();
    void this.recover();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async ensure(id: string) {
    const costs = this.db.db.collection<RoutingCost>("accounting_costs");
    const row = await costs.findOne({
      _id: new ObjectId(id),
      kind: "purchase",
      warehouseRoutingPending: true,
    });
    if (!row) return;
    const order = row.purchaseId
      ? await this.warehouse.purchase(row.purchaseId)
      : await this.warehouse.requestInvoice(row, row.actor);
    await costs.updateOne(
      { _id: row._id, warehouseRoutingPending: true },
      { $set: { purchaseId: order.id } },
    );
    if (order.status === "requested")
      await this.notices.forAccountingPurchase(order.id);
    else await this.notices.forWarehousePurchase(order.id);
    await costs.updateOne(
      { _id: row._id },
      { $set: { warehouseRoutingPending: false } },
    );
  }
  private async recover() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = await this.db.db
        .collection("accounting_costs")
        .find({ warehouseRoutingPending: true })
        .project({ _id: 1 })
        .limit(100)
        .toArray();
      for (const row of rows) {
        try {
          await this.ensure(String(row._id));
        } catch {
          this.logger.warn(
            "Una compra pendiente de Almacén se volverá a derivar.",
          );
        }
      }
    } catch {
      this.logger.warn(
        "Las compras pendientes de Almacén se volverán a derivar.",
      );
    } finally {
      this.busy = false;
    }
  }
}
