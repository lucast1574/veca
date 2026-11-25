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
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  accountingId,
  accountingMonth,
  workPayrollIncidentInput,
  incidentAuthorizationInput,
} from "@veca/content";
import { AuthModule } from "../auth/auth.module";
import { CrmModule } from "../crm/crm.controller";
import { RequirePermission, SessionEndpoint } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { PersonnelService } from "./personnel.service";
import { PayrollDeductions } from "./payroll-deductions.service";
import { PayrollApproval } from "./payroll-approval.service";
import { LaborProvider } from "../accounting/labor-provider";

@Controller("admin/works/:workId/payroll-incidents")
@RequirePermission("works")
class WorkIncidentsController {
  constructor(private readonly people: PersonnelService) {}
  @Get() list(@Param("workId") work: string, @Req() req: AuthenticatedRequest) {
    return this.people.work(work, req.session.user);
  }
  @Post() create(
    @Param("workId") work: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.people.create(
      work,
      parse(workPayrollIncidentInput, body),
      req.session.user,
    );
  }
  @Post(":id/authorize") authorize(
    @Param("workId") work: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(incidentAuthorizationInput, body);
    return this.people.transition(
      work,
      parse(accountingId, id),
      data.revision,
      req.session.user,
      data,
    );
  }
  @Post(":id/cancel") cancel(
    @Param("workId") work: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z.strictObject({ revision: z.number().int().nonnegative() }),
      body,
    );
    return this.people.transition(
      work,
      parse(accountingId, id),
      data.revision,
      req.session.user,
    );
  }
}
@Controller("admin/accounting/labor/accounts")
@RequirePermission("accounting_labor", "accounting")
class PayrollAccountsController {
  constructor(private readonly people: PersonnelService) {}
  @Get() list() {
    return this.people.accounts();
  }
  @Put(":employeeId") link(
    @Param("employeeId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z.strictObject({
        userId: accountingId.transform((v) => v.toLowerCase()).nullable(),
        revision: z.number().int().nonnegative(),
      }),
      body,
    );
    return this.people.link(
      parse(z.uuid(), id),
      data.userId,
      data.revision,
      req.session.user.username,
    );
  }
}
@Controller("account/payroll")
@SessionEndpoint()
class MyPayrollController {
  constructor(private readonly people: PersonnelService) {}
  @Get() async mine(
    @Query("period") period: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "private, no-store");
    try {
      return await this.people.mine(
        req.session.user.id,
        parse(accountingMonth, period),
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException)
        throw new ServiceUnavailableException(
          "Tu planilla no está disponible en este momento. Vuelve a intentarlo más tarde.",
        );
      throw error;
    }
  }
}
@Module({
  imports: [AuthModule, CrmModule],
  controllers: [
    WorkIncidentsController,
    PayrollAccountsController,
    MyPayrollController,
  ],
  providers: [
    LaborProvider,
    PersonnelService,
    PayrollDeductions,
    PayrollApproval,
  ],
  exports: [
    LaborProvider,
    PersonnelService,
    PayrollDeductions,
    PayrollApproval,
  ],
})
export class PersonnelModule {}
