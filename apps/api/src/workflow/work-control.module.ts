import { Controller, Get, Module, Param, Req } from "@nestjs/common";
import { CrmModule } from "../crm/crm.controller";
import { AccountingModule } from "../accounting/accounting.module";
import { AccountingService } from "../accounting/accounting.service";
import { Database } from "../database/database.module";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { RoleInbox } from "./role-inbox.service";
import { WorkAccess } from "../crm/work-access.service";
import { WorkReadiness } from "../crm/work-readiness.service";
@Controller("admin/work-control")
@RequirePermission("works")
class WorkControlController {
  constructor(
    private readonly access: WorkAccess,
    private readonly readiness: WorkReadiness,
    private readonly accounts: AccountingService,
    private readonly db: Database,
  ) {}
  @Get(":id/closeout")
  async closeout(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const work = await this.access.get(id, req.session.user);
    return this.readiness.snapshot(String(work._id));
  }
  @Get(":id/financials")
  @RequirePermission("accounting", "works")
  async financials(@Param("id") raw: string, @Req() req: AuthenticatedRequest) {
    const work = await this.access.get(raw, req.session.user);
    const id = String(work._id);
    const invoices = this.db.db.collection("accounting_invoices"),
      costs = this.db.db.collection("accounting_costs"),
      guides = this.db.db.collection("dispatches");
    const [
      margin,
      invoiceRows,
      costRows,
      guideRows,
      invoiceCount,
      costCount,
      guideCount,
    ] = await Promise.all([
      this.accounts.margin(id),
      invoices.find({ workId: id }).sort({ _id: -1 }).limit(50).toArray(),
      costs
        .find({ "allocations.workId": id })
        .sort({ _id: -1 })
        .limit(50)
        .toArray(),
      guides.find({ leadId: id }).sort({ _id: -1 }).limit(50).toArray(),
      invoices.countDocuments({ workId: id }),
      costs.countDocuments({ "allocations.workId": id }),
      guides.countDocuments({ leadId: id }),
    ]);
    return {
      margin,
      counts: { invoices: invoiceCount, costs: costCount, guides: guideCount },
      invoices: invoiceRows.map((r) => ({
        id: String(r._id),
        number: r.number || "Factura por preparar",
        status: r.status,
        total: r.totalCents || 0,
        paid: r.paidCents || 0,
      })),
      costs: costRows.map((r) => ({
        id: String(r._id),
        supplier: r.supplier || r.description || "Gasto de obra",
        reviewed: !!r.reviewed,
        proof: !!r.proofKey,
      })),
      guides: guideRows.map((r) => ({
        id: String(r._id),
        number: r.guideNumber || "Guía por preparar",
        version: r.version,
        status: r.status,
        canOpen: r.status !== "draft" || !!r.accountingCreationHash,
        departed: !!r.departedAt,
      })),
    };
  }
}
@Controller("admin/dashboard/inbox")
@RequirePermission("dashboard")
class InboxController {
  constructor(private readonly inbox: RoleInbox) {}
  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.inbox.forUser(req.session.user);
  }
}
@Module({
  imports: [CrmModule, AccountingModule],
  controllers: [WorkControlController, InboxController],
  providers: [RoleInbox],
})
export class WorkControlModule {}
