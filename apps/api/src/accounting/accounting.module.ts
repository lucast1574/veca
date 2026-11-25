import {
  Body,
  Controller,
  Get,
  ForbiddenException,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  accountingId,
  canViewAdministration,
  type FiscalOverview,
  accountingMonth,
  costInput,
  invoiceInput,
  invoicePayment,
  sireIncorporation,
} from "@veca/content";
import { Database } from "../database/database.module";
import { vecaDemoReport } from "../database/remove-veca-demo";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { WarehouseModule } from "../inventory/warehouse.module";
import { CrmModule } from "../crm/crm.controller";
import { MediaModule } from "../media/media.module";
import { ManualCostCheckService } from "./manual-cost-check.service";
import { PurchaseRoutingService } from "./purchase-routing.service";
import { AccountingPurchasesController } from "./accounting-purchases.controller";
import { AccountingService } from "./accounting.service";
import { SireService } from "./sire.service";
import { SireProvider } from "./sire-provider";
import { SireSyncService } from "./sire-sync.service";
import { SirePurchasesService } from "./sire-purchases.service";
import { LaborController } from "./labor.controller";
import { LaborProvider } from "./labor-provider";
import { LaborCostsService } from "./labor-costs.service";
import { InvoiceProvider } from "./invoice-provider";

const revision = z.object({ version: z.number().int().positive() }).strict();
const pageIndex = z.coerce.number().int().min(1).max(10_000);
const entry = z.object({ id: accountingId, data: z.unknown() }).strict();

@Controller("admin/accounting")
@RequirePermission("accounting")
class AccountingController {
  constructor(
    private readonly accounts: AccountingService,
    private readonly sire: SireService,
    private readonly purchases: SirePurchasesService,
    private readonly manualCosts: ManualCostCheckService,
  ) {}

  @Get("cost-origins")
  costOrigins() {
    return this.accounts.costOrigins();
  }

  @Get("works")
  works() {
    return this.accounts.works();
  }

  @Get("invoices")
  async invoices(@Query("page") page = "1", @Query("queue") queue?: string) {
    const list = await this.accounts.listInvoices(
      parse(pageIndex, page),
      queue ? parse(z.enum(["requested", "collect"]), queue) : undefined,
    );
    return { ...list, enabled: this.accounts.enabled };
  }

  @Get("invoices/:id")
  async invoice(@Param("id") id: string) {
    return {
      invoice: await this.accounts.invoice(parse(accountingId, id)),
      enabled: this.accounts.enabled,
    };
  }

  @Post("invoices")
  @RequirePermission("accounting_write", "accounting")
  createInvoice(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const { id, data } = parse(entry, raw);
    return this.accounts.createInvoice(
      parse(invoiceInput, data),
      request.session.user.username,
      id,
    );
  }

  @Put("invoices/:id")
  @RequirePermission("accounting_write", "accounting")
  editInvoice(@Param("id") id: string, @Body() raw: unknown) {
    const { version, data } = parse(
      revision.extend({ data: invoiceInput }),
      raw,
    );
    return this.accounts.editInvoice(parse(accountingId, id), version, data);
  }

  @Post("invoices/:id/issue")
  @RequirePermission("accounting_issue", "accounting")
  issue(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.accounts.issue(
      parse(accountingId, id),
      parse(revision, raw).version,
      request.session.user.username,
    );
  }

  @Post("invoices/:id/check")
  @RequirePermission("accounting_issue", "accounting")
  check(@Param("id") id: string, @Body() raw: unknown) {
    return this.accounts.check(
      parse(accountingId, id),
      parse(revision, raw).version,
    );
  }

  @Post("invoices/:id/payment")
  @RequirePermission("accounting_write", "accounting")
  payment(@Param("id") id: string, @Body() raw: unknown) {
    const { version, ...payment } = parse(invoicePayment, raw);
    return this.accounts.payment(parse(accountingId, id), version, payment);
  }

  @Get("invoices/:id/file/:type")
  async invoiceFile(
    @Param("id") id: string,
    @Param("type") format: string,
    @Res() res: Response,
  ) {
    const type = parse(z.enum(["pdf", "xml", "cdr"]), format);
    res
      .set({
        "Content-Type":
          type === "pdf" ? "application/pdf" : "application/octet-stream",
        "Content-Disposition": `attachment; filename="factura.${type === "cdr" ? "zip" : type}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      })
      .send(await this.accounts.invoiceFile(parse(accountingId, id), type));
  }

  @Get("costs")
  costs(
    @Query("page") page = "1",
    @Query("month") month?: string,
    @Query("purchase") purchase?: string,
  ) {
    return this.accounts.listCosts(
      parse(pageIndex, page),
      month ? parse(accountingMonth, month) : undefined,
      purchase ? parse(accountingId, purchase) : undefined,
    );
  }

  @Get("costs/:id")
  cost(@Param("id") id: string) {
    return this.accounts.cost(parse(accountingId, id));
  }

  @Post("costs")
  @RequirePermission("accounting_write", "accounting")
  async createCost(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const { id, data } = parse(entry, raw);
    const input = parse(costInput, data);
    const check = await this.manualCosts.check(input);
    if (
      check.status !== "clear" &&
      !(check.status === "registered" && check.costId === id)
    )
      return { check };
    return this.accounts.createCost(input, request.session.user.username, id);
  }

  @Put("costs/:id")
  @RequirePermission("accounting_write", "accounting")
  editCost(@Param("id") id: string, @Body() raw: unknown) {
    const { version, data } = parse(revision.extend({ data: costInput }), raw);
    return this.accounts.editCost(parse(accountingId, id), version, data);
  }

  @Post("costs/:id/proof")
  @RequirePermission("accounting_write", "accounting")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 8_000_000, files: 1 } }),
  )
  attach(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.accounts.attach(parse(accountingId, id), file);
  }

  @Get("costs/:id/proof")
  async proof(@Param("id") id: string, @Res() res: Response) {
    const file = await this.accounts.proof(parse(accountingId, id));
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="sustento.pdf"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    res.send(Buffer.from(await file.Body!.transformToByteArray()));
  }

  @Post("costs/:id/review")
  @RequirePermission("accounting_write", "accounting")
  review(@Param("id") id: string, @Body() raw: unknown) {
    return this.accounts.reviewCost(
      parse(accountingId, id),
      parse(revision, raw).version,
    );
  }

  @Get("sire/connection")
  sireConnection() {
    return this.sire.connection();
  }

  @Get("sire/purchases")
  pendingPurchases(
    @Query("month") month: string,
    @Query("page") page = "1",
    @Query("state") state = "pending",
    @Query("newSince") newSince?: string,
  ) {
    return this.purchases.list(
      parse(accountingMonth, month),
      parse(pageIndex, page),
      parse(z.enum(["pending", "all"]), state),
      parse(z.string().datetime().optional(), newSince),
    );
  }

  @Get("sire/purchases/:id")
  pendingPurchase(@Param("id") id: string) {
    return this.purchases.detail(parse(accountingId, id));
  }

  @Post("sire/purchases/:id/incorporate")
  @RequirePermission("accounting_write", "accounting")
  incorporatePurchase(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.purchases.incorporate(
      parse(accountingId, id),
      parse(sireIncorporation, raw),
      request.session.user.username,
    );
  }

  @Post("period/:month/reconcile/:book/automatic")
  @RequirePermission("accounting_write", "accounting")
  automatic(@Param("month") month: string, @Param("book") book: string) {
    return this.sire.automatic(
      parse(accountingMonth, month),
      parse(z.enum(["sales", "purchases"]), book),
    );
  }

  @Get("period/:month/reconcile/:book/automatic/:job")
  @RequirePermission("accounting_write", "accounting")
  automaticResult(
    @Param("month") month: string,
    @Param("book") book: string,
    @Param("job") job: string,
  ) {
    return this.sire.automatic(
      parse(accountingMonth, month),
      parse(z.enum(["sales", "purchases"]), book),
      parse(
        z
          .string()
          .min(1)
          .max(2000)
          .regex(/^v1\.[\w.-]+$/),
        job,
      ),
    );
  }

  @Post("period/:month/reconcile/:book")
  @RequirePermission("accounting_write", "accounting")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 8_000_000, files: 1 } }),
  )
  reconcile(
    @Param("month") month: string,
    @Param("book") book: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.sire.reconcile(
      parse(accountingMonth, month),
      parse(z.enum(["sales", "purchases"]), book),
      file,
    );
  }

  @Get("period/:month")
  period(@Param("month") month: string) {
    return this.accounts.period(parse(accountingMonth, month));
  }

  @Get("period/:month/:export")
  async export(
    @Param("month") raw: string,
    @Param("export") requested: string,
    @Res() res: Response,
  ) {
    const month = parse(accountingMonth, raw);
    const file = parse(z.enum(["sales.csv", "costs.csv"]), requested);
    const body = await this.accounts.exportPeriod(
      month,
      file === "sales.csv" ? "sales" : "costs",
    );
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${month}-${file}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      })
      .send(body);
  }

  @Get("margin/:work")
  margin(@Param("work") id: string) {
    return this.accounts.margin(parse(accountingId, id).toLowerCase());
  }
}

@Controller("admin/crm/leads/:workId/invoice-request")
@RequirePermission("dispatches")
class LeadInvoiceRequestController {
  constructor(private readonly accounts: AccountingService) {}

  @Get()
  status(@Param("workId") id: string) {
    return this.accounts.requestedInvoice(parse(accountingId, id));
  }

  @Post()
  create(@Param("workId") id: string, @Req() request: AuthenticatedRequest) {
    return this.accounts.requestInvoice(
      parse(accountingId, id),
      request.session.user.username,
    );
  }
}

@RequirePermission("users")
@Controller("admin/administration/fiscal")
class FiscalConnectionController {
  constructor(
    private readonly invoiceProvider: InvoiceProvider,
    private readonly db: Database,
  ) {}

  @Get()
  async check(@Req() req: AuthenticatedRequest): Promise<FiscalOverview> {
    if (!canViewAdministration(req.session.user))
      throw new ForbiddenException();
    const [readiness, cleanup] = await Promise.all([
      this.invoiceProvider.readiness(),
      vecaDemoReport(this.db.db),
    ]);
    return { ...readiness, cleanup };
  }
}

@Module({
  imports: [CrmModule, MediaModule, WarehouseModule],
  controllers: [
    AccountingController,
    AccountingPurchasesController,
    LeadInvoiceRequestController,
    FiscalConnectionController,
    LaborController,
  ],
  exports: [AccountingService],
  providers: [
    AccountingService,
    ManualCostCheckService,
    PurchaseRoutingService,
    InvoiceProvider,
    SireService,
    SirePurchasesService,
    SireSyncService,
    SireProvider,
    LaborProvider,
    LaborCostsService,
  ],
})
export class AccountingModule {}
