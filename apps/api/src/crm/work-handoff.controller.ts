import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { WorkAccess } from "./work-access.service";

@Controller("admin/crm")
@RequirePermission("leads")
export class WorkHandoffController {
  constructor(private readonly access: WorkAccess) {}

  @Get("work-people")
  people() {
    return this.access.people();
  }

  @Post("leads/:id/handoff")
  handoff(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.access.handoff(id, body, req.session.user);
  }
}
