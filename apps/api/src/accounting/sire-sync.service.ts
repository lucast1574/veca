import {
  Injectable,
  BadRequestException,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { Database } from "../database/database.module";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";
import { SireService } from "./sire.service";

type Sync = {
  _id: string;
  syncedAt?: string;
  job?: string;
  lease?: string;
  lockUntil?: Date;
  retryAt?: Date;
  failed?: boolean;
};
@Injectable()
export class SireSyncService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(SireSyncService.name);
  constructor(
    private readonly db: Database,
    private readonly sire: SireService,
  ) {}
  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === "test" ||
      !fiscalLiveKey.startsWith("asu_live_") ||
      !/^\d{11}$/.test(fiscalIssuerRuc)
    )
      return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const current = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      const [year, month] = current.split("-").map(Number);
      const previous = new Date(Date.UTC(year, month - 2, 1))
        .toISOString()
        .slice(0, 7);
      const pending = await this.db.db
        .collection<Sync>("sire_purchase_syncs")
        .find({ job: { $exists: true } })
        .project({ _id: 1 })
        .limit(12)
        .toArray();
      for (const period of new Set([
        current,
        previous,
        ...pending.map((row) => row._id),
      ]))
        await this.sync(period);
    } catch {
      this.logger.warn(
        "La actualización automática de compras se reintentará.",
      );
    } finally {
      this.busy = false;
    }
  }
  private async sync(period: string) {
    const records = this.db.db.collection<Sync>("sire_purchase_syncs");
    const previous = await records.findOne({ _id: period });
    const now = new Date();
    if (previous?.retryAt && previous.retryAt > now) return;
    if (
      !previous?.job &&
      previous?.syncedAt &&
      now.getTime() - Date.parse(previous.syncedAt) < 15 * 60_000
    )
      return;
    const lease = randomUUID();
    let state: Sync | null;
    try {
      state = await records.findOneAndUpdate(
        {
          _id: period,
          $or: [{ lockUntil: { $lt: now } }, { lockUntil: { $exists: false } }],
        },
        { $set: { lease, lockUntil: new Date(now.getTime() + 120_000) } },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return;
      throw error;
    }
    if (!state) return;
    try {
      const result = await this.sire.automatic(period, "purchases", state.job);
      await records.updateOne(
        { _id: period, lease },
        result.status === "pending"
          ? {
              $set: { job: result.job, failed: false },
              $unset: { lease: "", lockUntil: "", retryAt: "" },
            }
          : {
              $set: { failed: false },
              $unset: { job: "", lease: "", lockUntil: "", retryAt: "" },
            },
      );
    } catch (error) {
      // An expired sealed job cannot be resumed; transient outages retain it.
      const invalidJob = error instanceof BadRequestException;
      await records.updateOne(
        { _id: period, lease },
        {
          $set: { failed: true, retryAt: new Date(Date.now() + 5 * 60_000) },
          $unset: { lease: "", lockUntil: "", ...(invalidJob && { job: "" }) },
        },
      );
      this.logger.warn(
        "No se pudieron actualizar las compras. Se reintentará automáticamente.",
      );
    }
  }
}
