import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  canViewAdministration,
  DEMO_CASES,
  isDemoLead,
  type DemoLink,
  type Lead,
  type LeadInput,
} from "@veca/content";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { RequirePermission } from "../auth/route-access";
import { CrmRepository } from "../crm/crm.repository";
import { CrmService } from "../crm/crm.service";
import { DemoInvoiceService } from "./demo-invoice.service";
import { DispatchService } from "./dispatch.service";
import { limaDate } from "./guide-provider";

@Injectable()
export class DemoService {
  constructor(
    private readonly leads: CrmRepository,
    private readonly crm: CrmService,
    private readonly dispatches: DispatchService,
  ) {}

  async links(seed = false, actor = ""): Promise<DemoLink[]> {
    const links: DemoLink[] = [];
    for (const example of DEMO_CASES) {
      const entry = await this.leads.collection.findOne({
        name: example.name,
        email: /\.invalid$/i,
        source: "manual",
      });
      if (!entry || !isDemoLead(entry)) continue;
      let lead = this.leads.view(entry);
      if (seed) lead = await this.prepareLead(lead, example, actor);
      const dispatchId =
        seed && ["coordination", "execution", "completed"].includes(lead.stage)
          ? await this.dispatches.demoLink(example.key, lead.id)
          : ((await this.dispatches.forLead(lead.id)).find(
              (dispatch) => dispatch.demo,
            )?.id ?? null);
      links.push({ key: example.key, leadId: lead.id, dispatchId });
    }
    return links;
  }

  private async prepareLead(
    lead: Lead,
    example: (typeof DEMO_CASES)[number],
    actor: string,
  ) {
    if (lead.stage !== "prelead" && lead.stage !== "contacted") return lead;
    const state: LeadInput = {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      district: example.district,
      requestType: lead.requestType || "premium",
      segment: lead.segment || "high",
      idea: example.idea,
      stage: "contacted",
      version: lead.version,
      assignedTo: lead.assignedTo || "Operaciones",
      contactResult:
        lead.contactResult || "Cliente de ejemplo confirma el alcance.",
      appointment:
        lead.appointment ||
        limaDate(new Date(Date.now() + 86_400_000)) + "T08:00",
      address: lead.address || `Dirección de ejemplo · ${example.district}`,
      workPlan: lead.workPlan || example.idea,
      contractStatus: lead.contractStatus,
      contractReference: lead.contractReference,
      completionNote: lead.completionNote,
      discardReason: lead.discardReason,
    };
    let current = lead;
    if (current.stage === "prelead")
      current = await this.crm.update(lead.id, state, actor);
    current = await this.crm.update(
      lead.id,
      { ...state, stage: "coordination", version: current.version },
      actor,
    );
    if (example.key === "mamparas")
      current = await this.crm.update(
        lead.id,
        { ...state, stage: "execution", version: current.version },
        actor,
      );
    return current;
  }
}

@Controller("admin/administration/demo")
@RequirePermission("users")
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly invoices: DemoInvoiceService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    this.check(req);
    return this.demo.links();
  }

  @Post("prepare")
  prepare(@Req() req: AuthenticatedRequest) {
    this.check(req);
    return this.demo.links(true, req.session.user.username);
  }

  @Get("connection")
  connection(@Req() req: AuthenticatedRequest) {
    this.check(req);
    return this.invoices.checkConnection();
  }

  @Get("invoices")
  listInvoices(@Req() req: AuthenticatedRequest) {
    this.check(req);
    return this.invoices.list();
  }

  @Post("invoices")
  generateInvoices(@Req() req: AuthenticatedRequest) {
    this.check(req);
    return this.invoices.generate();
  }

  @Get("invoices/:key/pdf")
  async invoicePdf(
    @Param("key") key: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    this.check(req);
    const pdf = await this.invoices.pdf(key);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="factura-de-prueba.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(pdf);
  }

  private check(req: AuthenticatedRequest) {
    if (!canViewAdministration(req.session.user))
      throw new ForbiddenException(
        "La demostración está disponible para Administración.",
      );
  }
}
