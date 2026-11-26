import {
  Injectable,
  BadRequestException,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { SireBook } from "@veca/content";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { Database } from "../database/database.module";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";
import { SireService } from "./sire.service";

type Sync = {
  _id: string;
  issuerRuc?: string;
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
      for (const book of ["purchases", "sales"] as const) {
        try {
          const pending = await this.records(book)
            .find({ job: { $exists: true } })
            .project({ _id: 1 })
            .limit(12)
            .toArray();
          for (const period of new Set([
            current,
            previous,
            ...pending.map((row) => row._id),
          ]))
            await this.sync(period, book);
        } catch {
          this.logger.warn(
            `La sincronización fiscal de ${book} se reintentará.`,
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private records(book: SireBook) {
    return this.db.db.collection<Sync>(
      book === "purchases" ? "sire_purchase_syncs" : "sire_sales_syncs",
    );
  }

  private async sync(period: string, book: SireBook) {
    const records = this.records(book);
    const previous = await records.findOne(
      { _id: period },
      { projection: { job: 1, syncedAt: 1, retryAt: 1 } },
    );
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
        { upsert: true, returnDocument: "after", projection: { job: 1 } },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return;
      throw error;
    }
    if (!state) return;
    const locked = { _id: period, lease };
    const release = { lease: "", lockUntil: "" } as const;
    try {
      const result = await this.sire.automatic(period, book, state.job);
      if (book === "sales") {
        await records.updateOne(locked, { $unset: release });
        return;
      }
      await records.updateOne(
        locked,
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
      const failed = {
        failed: true,
        retryAt: new Date(Date.now() + 5 * 60_000),
      };
      if (book === "sales") {
        await records.updateOne(
          {
            ...locked,
            job: state.job ?? { $exists: false },
            $or: [
              { issuerRuc: fiscalIssuerRuc },
              { issuerRuc: { $exists: false } },
            ],
          },
          {
            $set: { ...failed, issuerRuc: fiscalIssuerRuc },
            ...(invalidJob && { $unset: { job: "" } }),
          },
        );
        await records.updateOne(locked, { $unset: release });
        this.logger.warn(
          "Falló la sincronización fiscal de ventas. Se reintentará automáticamente.",
        );
        return;
      }
      await records.updateOne(locked, {
        $set: failed,
        $unset: { ...release, ...(invalidJob && { job: "" }) },
      });
      this.logger.warn(
        `Falló la sincronización fiscal de ${book}. Se reintentará automáticamente.`,
      );
    }
  }
}
