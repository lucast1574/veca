import { z } from "zod";
import { parse } from "../common/validation";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Query,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { RequirePermission } from "../auth/route-access";
import { WorkAccess } from "../crm/work-access.service";
import { SupplyRequests } from "./supply-requests.service";
import { InventoryService } from "./inventory.service";

@Controller("admin/works/:workId/supplies")
@RequirePermission("works")
export class WorkSupplyRequestsController {
  constructor(
    private readonly requests: SupplyRequests,
    private readonly access: WorkAccess,
    private readonly inventory: InventoryService,
  ) {}
  @Get()
  async list(
    @Param("workId") id: string,
    @Req() req: AuthenticatedRequest,
    @Query("page") page = "1",
    @Query("filter") filter = "open",
  ) {
    await this.access.get(id, req.session.user);
    return this.requests.list(
      id,
      parse(z.coerce.number().int().min(1).max(10000), page),
      parse(z.enum(["open", "all"]), filter),
    );
  }
  @Get("materials")
  async materials(
    @Param("workId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.get(id, req.session.user);
    return (await this.inventory.list("")).map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      unit: row.unit,
    }));
  }
  @Post()
  create(
    @Param("workId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.create(id, body, req.session.user);
  }
  @Post(":id/actions")
  async action(
    @Param("workId") workId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.get(workId, req.session.user);
    const row = await this.requests.collection.findOne({
      _id: this.inventory.id(id),
      workId,
    });
    if (!row) throw new NotFoundException();
    return this.requests.action(id, body, req.session.user, false);
  }
}

@Controller("admin/supply-requests")
@RequirePermission("inventory")
export class SupplyRequestsController {
  constructor(private readonly requests: SupplyRequests) {}
  @Get()
  list(@Query("page") page = "1", @Query("filter") filter = "open") {
    return this.requests.list(
      undefined,
      parse(z.coerce.number().int().min(1).max(10000), page),
      parse(z.enum(["open", "all"]), filter),
    );
  }
  @Get(":id")
  detail(@Param("id") id: string) {
    return this.requests.detail(id);
  }
  @Get(":id/guides")
  guides(@Param("id") id: string) {
    return this.requests.guides(id);
  }
  @Post(":id/cancel-delivery")
  cancelDelivery(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const { version } = parse(
      z.object({ version: z.number().int().positive() }).strict(),
      body,
    );
    return this.requests.cancelDelivery(id, version, req.session.user);
  }
  @Post(":id/actions")
  action(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.action(id, body, req.session.user, true);
  }
}
