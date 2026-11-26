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
} from "@nestjs/common";
import { z } from "zod";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { CrmModule } from "../crm/crm.controller";
import { InventoryService } from "./inventory.service";
import { SupplyRequests } from "./supply-requests.service";
import {
  SupplyRequestsController,
  WorkSupplyRequestsController,
} from "./supply-requests.controller";
import { DispatchModule } from "../dispatch/dispatch.module";
import { WarehouseService } from "./warehouse.service";

@RequirePermission("inventory")
@Controller("admin/warehouse")
class WarehouseController {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly inventory: InventoryService,
  ) {}

  @Post("materials/import/preview")
  @RequirePermission("inventory_catalog", "inventory")
  previewMaterials(@Body() raw: unknown) {
    return this.inventory.previewImport(raw);
  }

  @Post("materials/import")
  @RequirePermission("inventory_catalog", "inventory")
  importMaterials(@Body() raw: unknown) {
    return this.inventory.importMaterials(raw);
  }

  @Post("materials/:id/count")
  @RequirePermission("inventory_adjust", "inventory")
  count(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.inventory.count(id, raw, req.session.user.username);
  }

  @Put("materials/:id/dimensions")
  @RequirePermission("inventory_catalog", "inventory")
  dimensions(@Param("id") id: string, @Body() raw: unknown) {
    return this.inventory.updateDimensions(id, raw);
  }

  @Get("works")
  works() {
    return this.warehouse.works();
  }

  @Get("works/:id")
  work(@Param("id") id: string) {
    return this.warehouse.supply(id);
  }

  @Put("works/:id")
  @RequirePermission("works_manage", "inventory")
  plan(@Param("id") id: string, @Body() raw: unknown) {
    return this.warehouse.savePlan(id, raw);
  }

  @Get("purchases")
  purchases(
    @Query("page") page = "1",
    @Query("search") search = "",
    @Query("status") status?: string,
  ) {
    return this.warehouse.listPurchases(
      parse(z.coerce.number().int().min(1).max(10000), page),
      parse(z.string(), search),
      status
        ? parse(
            z.enum(["requested", "open", "partial", "received", "cancelled"]),
            status,
          )
        : undefined,
    );
  }

  @Get("purchases/:id")
  purchase(@Param("id") id: string) {
    return this.warehouse.purchase(id);
  }

  @Post("purchases")
  @RequirePermission("accounting_write", "accounting")
  createPurchase(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    return this.warehouse.createPurchase(raw, req.session.user.username);
  }

  @Post("purchase-requests")
  @RequirePermission("inventory_request", "inventory")
  requestPurchase(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    return this.warehouse.requestPurchase(raw, req.session.user.username);
  }

  @Put("purchases/:id/order")
  @RequirePermission("accounting_write", "accounting")
  orderPurchase(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warehouse.orderPurchase(id, raw, req.session.user.username);
  }

  @Post("purchases/:id/receive")
  @RequirePermission("inventory_receive", "inventory")
  receive(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warehouse.receive(id, raw, req.session.user.username);
  }

  @Post("purchases/:id/cancel")
  @RequirePermission("accounting_write", "accounting")
  cancel(@Param("id") id: string) {
    return this.warehouse.cancelPurchase(id);
  }

  @Get("equipment")
  equipment() {
    return this.warehouse.listEquipment();
  }

  @Get("equipment/:id")
  equipmentDetail(@Param("id") id: string) {
    return this.warehouse.equipmentDetail(id);
  }

  @Post("equipment")
  @RequirePermission("inventory_equipment", "inventory")
  createEquipment(@Body() raw: unknown) {
    return this.warehouse.createEquipment(raw);
  }

  @Post("equipment/:id")
  @RequirePermission("inventory_equipment", "inventory")
  equipmentAction(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warehouse.equipmentAction(id, raw, req.session.user.username);
  }

  @Put("equipment/:id")
  @RequirePermission("inventory_equipment", "inventory")
  updateEquipment(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warehouse.updateEquipment(id, raw, req.session.user.username);
  }
}

@Module({
  imports: [CrmModule, DispatchModule],
  controllers: [
    WarehouseController,
    SupplyRequestsController,
    WorkSupplyRequestsController,
  ],
  providers: [WarehouseService, SupplyRequests],
  exports: [WarehouseService],
})
export class WarehouseModule {}
