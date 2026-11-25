import { PayrollDeductions } from "../personnel/payroll-deductions.service";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  accountingMonth,
  employeeInput,
  laborEmployee,
  payrollInput,
  payrollRun,
  payrollTransition,
  laborReceipt,
  honorariumInput,
  honorariumPayment,
  laborAllocationInput,
} from "@veca/content";
import { z } from "zod";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { LaborCostsService } from "./labor-costs.service";
import { LaborProvider } from "./labor-provider";

const idSchema = z.uuid();
const revision = z.number().int().nonnegative();

@Controller("admin/accounting/labor")
@RequirePermission("accounting_labor", "accounting")
export class LaborController {
  constructor(
    private readonly labor: LaborCostsService,
    private readonly provider: LaborProvider,
    private readonly deductions: PayrollDeductions,
  ) {}

  @Get()
  workspace(@Query("period") period: string) {
    return this.labor.workspace(parse(accountingMonth, period));
  }

  @Post("employees")
  newEmployee(@Body() body: unknown) {
    return this.provider.request("employees", laborEmployee, {
      method: "POST",
      data: parse(employeeInput, body),
    });
  }
  @Put("employees/:id")
  editEmployee(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    return this.provider.request(`employees/${id}`, laborEmployee, {
      method: "PUT",
      data: parse(employeeInput.extend({ revision }), body),
    });
  }

  @Post("runs")
  newRun(@Body() body: unknown) {
    return this.provider.request("runs", payrollRun, {
      method: "POST",
      data: parse(payrollInput, body),
    });
  }
  @Put("runs/:id")
  editRun(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    const { manualOtherDeductions, ...data } = parse(
      payrollInput.extend({
        revision,
        manualOtherDeductions: z.boolean().optional(),
      }),
      body,
    );
    return this.deductions.edit(id, data, manualOtherDeductions === true);
  }
  @Post("runs/:id/status")
  async runStatus(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    const data = parse(payrollTransition, body);
    await this.deductions.beforeStatus(id, data.status);
    const saved = await this.provider.request(`runs/${id}/status`, payrollRun, {
      method: "POST",
      data,
    });
    if (saved.status === "void") await this.deductions.afterVoid(id);
    return saved;
  }

  @Post("runs/:id/work-deductions")
  applyDeductions(
    @Param("id") raw: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z.strictObject({
        revision,
        operationId: z.uuid(),
        incidentIds: z
          .array(z.string().regex(/^[a-f0-9]{24}$/))
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
      }),
      body,
    );
    return this.deductions.apply(
      parse(idSchema, raw),
      data.revision,
      data.operationId,
      data.incidentIds,
      req.session.user.username,
    );
  }

  @Post("receipts")
  newReceipt(@Body() body: unknown) {
    const input = parse(honorariumInput, body);
    return this.provider.request("receipts", laborReceipt, {
      method: "POST",
      data: this.received(input),
    });
  }
  @Put("receipts/:id")
  async editReceipt(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    const input = parse(honorariumInput.extend({ revision }), body);
    await this.labor.receivedReceipt(id);
    return this.provider.request(`receipts/${id}`, laborReceipt, {
      method: "PUT",
      data: this.received(input),
    });
  }
  @Post("receipts/:id/payments")
  async receiptPayment(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    const data = parse(honorariumPayment, body);
    await this.labor.receivedReceipt(id);
    return this.provider.request(`receipts/${id}/payments`, laborReceipt, {
      method: "POST",
      data,
    });
  }
  @Post("receipts/:id/void")
  async receiptVoid(@Param("id") raw: string, @Body() body: unknown) {
    const id = parse(idSchema, raw);
    const data = parse(z.strictObject({ revision }), body);
    await this.labor.receivedReceipt(id);
    return this.provider.request(`receipts/${id}/void`, laborReceipt, {
      method: "POST",
      data,
    });
  }

  @Put("allocation")
  allocation(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.labor.save(
      parse(laborAllocationInput, body),
      request.session.user.username,
    );
  }

  private received(data: object) {
    return {
      ...data,
      direction: "received",
      customerDocumentType: "RUC",
      customerDocumentNumber: fiscalIssuerRuc,
      customerName: "VECAGLASS S.A.C.",
    };
  }
}
