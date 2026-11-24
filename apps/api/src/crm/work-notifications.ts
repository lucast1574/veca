import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Subscription } from "rxjs";
import { CrmEvents } from "./crm.events";
import { CrmRepository } from "./crm.repository";
import { Notifications } from "../notifications/notifications.service";
@Injectable()
export class WorkNotifications implements OnModuleInit, OnModuleDestroy {
  private stream?: Subscription;
  private timer?: NodeJS.Timeout;
  private scheduled?: NodeJS.Timeout;
  private running = false;
  private rerun = false;
  private readonly logger = new Logger(WorkNotifications.name);
  constructor(
    private readonly events: CrmEvents,
    private readonly crm: CrmRepository,
    private readonly notices: Notifications,
  ) {}
  onModuleInit() {
    this.stream = this.events.stream.subscribe((event) => {
      if (event.data.topic !== "heartbeat") this.schedule();
    });
    this.timer = setInterval(() => this.schedule(), 30000);
    this.timer.unref();
    this.schedule();
  }
  onModuleDestroy() {
    this.stream?.unsubscribe();
    clearInterval(this.timer);
    clearTimeout(this.scheduled);
  }
  private schedule() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (!this.scheduled)
      this.scheduled = setTimeout(() => {
        this.scheduled = undefined;
        void this.reconcile();
      }, 150);
  }
  private async reconcile() {
    this.running = true;
    try {
      this.notices.refreshAudience();
      const cursor = this.crm.collection.find({
        $or: [
          { stage: { $in: ["prelead", "coordination", "execution"] } },
          {
            stage: "completed",
            updatedAt: {
              $gte: new Date(Date.now() - 30 * 86400000).toISOString(),
            },
          },
        ],
      });
      for await (const row of cursor) await this.notices.forWork(row);
    } catch {
      this.logger.warn("La bandeja de avisos se volverá a sincronizar.");
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        this.schedule();
      }
    }
  }
}
