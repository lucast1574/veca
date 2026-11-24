import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { RequirePermission } from "../auth/route-access";
import { CrmModule } from "../crm/crm.controller";
import { parse } from "../common/validation";
import { DemoInvoiceService } from "./demo-invoice.service";
import { DemoController, DemoService } from "./demo.controller";
import { DispatchService } from "./dispatch.service";
import { GuideProvider } from "./guide-provider";

const revision = z.object({ version: z.number().int().positive() }).strict();
const update = revision.extend({ data: z.unknown() });
const documentId = z.string().regex(/^[0-9a-f]{24}$/i);
const guideDraft = z
  .object({ id: documentId, leadId: documentId, data: z.unknown() })
  .strict();
const sendBack = revision.extend({
  observation: z.string().trim().min(3).max(500),
});

function sendPdf(res: Response, pdf: Buffer) {
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="guia-remision.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .send(pdf);
}

@RequirePermission("dispatches")
@Controller("admin/crm/leads/:leadId/dispatches")
class LeadDispatchController {
  constructor(private readonly dispatches: DispatchService) {}

  @Get()
  list(@Param("leadId") leadId: string) {
    return this.dispatches.forLead(leadId);
  }

  @Post()
  create(
    @Param("leadId") leadId: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dispatches.create(leadId, input, req.session.user.username);
  }

  @Put(":id")
  update(
    @Param("leadId") leadId: string,
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version, data } = parse(update, input);
    return this.dispatches.update(
      leadId,
      id,
      version,
      data,
      req.session.user.username,
    );
  }

  @Post(":id/submit")
  submit(
    @Param("leadId") leadId: string,
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version } = parse(revision, input);
    return this.dispatches.submit(
      leadId,
      id,
      version,
      req.session.user.username,
    );
  }

  @RequirePermission("inventory_dispatch", "inventory")
  @Post(":id/depart")
  depart(
    @Param("leadId") leadId: string,
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dispatches.depart(leadId, id, req.session.user.username);
  }

  @Get(":id/pdf")
  async pdf(
    @Param("leadId") leadId: string,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.dispatches.download(id, leadId));
  }
}

@RequirePermission("accounting")
@Controller("admin/accounting/guides")
class AccountingGuideController {
  constructor(private readonly dispatches: DispatchService) {}

  @Get()
  queue(
    @Query("page") rawPage = "1",
    @Query("status") rawStatus = "all",
    @Query("search") search = "",
  ) {
    const page = parse(z.coerce.number().int().min(1).max(10_000), rawPage);
    const status = parse(
      z.enum(["all", "draft", "review", "issued"]),
      rawStatus,
    );
    return this.dispatches.queue(page, status, parse(z.string(), search));
  }

  @Get("works")
  works(@Query("search") search = "") {
    return this.dispatches.works(parse(z.string(), search));
  }

  @Post()
  create(@Body() input: unknown, @Req() req: AuthenticatedRequest) {
    const { id, leadId, data } = parse(guideDraft, input);
    return this.dispatches.create(leadId, data, req.session.user.username, id);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.dispatches.detail(id);
  }

  @Put(":id")
  updateDraft(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { data, version } = parse(update, input);
    return this.dispatches.updateDraft(
      id,
      version,
      data,
      req.session.user.username,
    );
  }

  @Post(":id/return")
  return(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version, observation } = parse(sendBack, input);
    return this.dispatches.sendBack(
      id,
      version,
      observation,
      req.session.user.username,
    );
  }

  @Post(":id/issue")
  issue(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version } = parse(revision, input);
    return this.dispatches.issue(id, version, req.session.user.username);
  }

  @Post(":id/check")
  check(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version } = parse(revision, input);
    return this.dispatches.check(id, version, req.session.user.username);
  }

  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @Res() res: Response) {
    sendPdf(res, await this.dispatches.download(id));
  }
}

@Module({
  imports: [CrmModule],
  controllers: [
    LeadDispatchController,
    AccountingGuideController,
    DemoController,
  ],
  providers: [DispatchService, GuideProvider, DemoService, DemoInvoiceService],
  exports: [DispatchService],
})
export class DispatchModule {}
