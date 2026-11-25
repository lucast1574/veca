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
import { z } from "zod";
import { accountingId } from "@veca/content";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { WarehouseService } from "../inventory/warehouse.service";
import { InventoryService } from "../inventory/inventory.service";

@Controller("admin/accounting")
@RequirePermission("accounting")
export class AccountingPurchasesController {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly inventory: InventoryService,
  ) {}
  @Get("purchase-materials")
  materials() {
    return this.inventory.list();
  }
  @Post("purchase-materials")
  @RequirePermission("accounting_write", "accounting")
  createMaterial(@Body() data: unknown) {
    return this.inventory.create(data);
  }
  @Get("purchase-works")
  works() {
    return this.warehouse.works();
  }
  @Get("purchase-orders")
  list(@Query("page") page = "1") {
    return this.warehouse.listPurchases(
      parse(z.coerce.number().int().min(1).max(10000), page),
      "",
      "requested",
    );
  }
  @Get("purchase-orders/:id")
  detail(@Param("id") id: string) {
    return this.warehouse.purchase(parse(accountingId, id));
  }
  @Post("purchase-orders")
  @RequirePermission("accounting_write", "accounting")
  create(@Body() data: unknown, @Req() req: AuthenticatedRequest) {
    return this.warehouse.createPurchase(data, req.session.user.username);
  }
  @Put("purchase-orders/:id/order")
  @RequirePermission("accounting_write", "accounting")
  prepare(
    @Param("id") id: string,
    @Body() data: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warehouse.orderPurchase(
      parse(accountingId, id),
      data,
      req.session.user.username,
    );
  }
  @Post("purchase-orders/:id/cancel")
  @RequirePermission("accounting_write", "accounting")
  cancel(@Param("id") id: string) {
    return this.warehouse.cancelPurchase(parse(accountingId, id));
  }
}
