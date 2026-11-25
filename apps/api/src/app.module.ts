import { WorkControlModule } from "./workflow/work-control.module";
import { SuggestionsModule } from "./suggestions/suggestions.module";
import { WarehouseModule } from "./inventory/warehouse.module";
import { Controller, Get, Module, Res } from "@nestjs/common";
import type { Response } from "express";
import { DatabaseModule, Database } from "./database/database.module";
import { AccessModule } from "./access/access.controller";
import { MailModule } from "./mail/mail.service";
import { ProfileModule } from "./profile/profile.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { MediaModule } from "./media/media.module";
import { AccountingModule } from "./accounting/accounting.module";
import { DispatchModule } from "./dispatch/dispatch.module";
import { CrmModule } from "./crm/crm.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { PublicEndpoint, RequirePermission } from "./auth/route-access";
import { StorageService } from "./media/storage.service";
@Controller()
class HealthController {
  constructor(
    private readonly database: Database,
    private readonly storage: StorageService,
  ) {}
  @PublicEndpoint()
  @Get("health")
  async health(@Res({ passthrough: true }) res: Response) {
    res.setHeader("X-Robots-Tag", "noindex");
    await this.database.db.command({ ping: 1 });
    return { status: "ok" };
  }
  @RequirePermission("dashboard")
  @Get("admin/system")
  system() {
    return { storageConfigured: this.storage.configured };
  }
  @PublicEndpoint()
  @Get("health/ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    res.setHeader("X-Robots-Tag", "noindex");
    await this.database.db.command({ ping: 1 });
    await this.storage.check();
    return { status: "ok", database: "connected", storage: "connected" };
  }
}
@Module({
  imports: [
    DatabaseModule,
    MailModule,
    AuthModule,
    NotificationsModule,
    ProfileModule,
    AccessModule,
    ProjectsModule,
    MediaModule,
    CrmModule,
    DispatchModule,
    AccountingModule,
    WarehouseModule,
    WorkControlModule,
    SuggestionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
