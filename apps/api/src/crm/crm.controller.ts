import { WorkTasksController } from "./work-tasks.controller";
import { WorkNotifications } from "./work-notifications";
import { WorkStageRequests, WorkStageController } from "./work-stage-requests";
import { WorkHandoffController } from "./work-handoff.controller";
import { WorkAccess } from "./work-access.service";
import { CrmEvents } from "./crm.events";
import { WorksController } from "./works.controller";
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
  UploadedFile,
  UseInterceptors,
  Sse,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { WorkGate } from "./work-gate.service";
import { WorkReadiness } from "./work-readiness.service";
import { SupplyDispatches } from "../inventory/supply-dispatch.service";
import { leadUpdateSchema, movementSchema } from "@veca/content";
import { GalleryController } from "../gallery/gallery.controller";
import { MobileGalleryController } from "../gallery/mobile-gallery.controller";
import { GalleryService } from "../gallery/gallery.service";
import { GalleryUploads } from "../gallery/gallery-uploads";
import { MobileGalleryAccess } from "../gallery/mobile-gallery-access";
import { PublicEndpoint, RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { AuthModule } from "../auth/auth.module";
import { MediaModule } from "../media/media.module";
import { parse } from "../common/validation";
import { CrmService } from "./crm.service";
import { CrmRepository } from "./crm.repository";
import { CrmFiles, photoMetadataFromForm } from "./crm.files";
import { InventoryService } from "../inventory/inventory.service";
@Controller("public/consultations")
class ConsultationController {
  constructor(private readonly crm: CrmService) {}
  @PublicEndpoint()
  @Post()
  create(@Body() body: unknown) {
    return this.crm.create(body);
  }
  @PublicEndpoint()
  @Post("social")
  createFromSocial(@Body() body: unknown) {
    return this.crm.createFromSocial(body);
  }
}
@RequirePermission("leads")
@Controller("admin/crm")
class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly files: CrmFiles,
    private readonly inventory: InventoryService,
    private readonly gate: WorkGate,
    private readonly events: CrmEvents,
  ) {}
  @RequirePermission("dashboard")
  @Sse("events")
  stream() {
    return this.events.stream;
  }
  @Get("leads") list(
    @Query("search") search = "",
    @Query("page") page = "1",
    @Query("stage") stage = "",
    @Query("segment") segment = "",
  ) {
    return this.crm.list(search, Number(page), stage, segment);
  }
  @Post("leads") create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.crm.create(body, "manual", req.session.user.username);
  }
  @Get("leads/:id") async detail(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      lead: await this.crm.get(id),
      attachments: await this.files.list(id),
      movements: req.session.user.permissions.includes("inventory")
        ? await this.inventory.movements(id)
        : [],
    };
  }
  @Put("leads/:id") async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(leadUpdateSchema, body);
    const existing = await this.crm.get(id);
    if (
      existing.workHandoff &&
      existing.workHandoff.status !== "returned" &&
      !req.session.user.permissions.includes("works_manage")
    )
      throw new ForbiddenException(
        "La entrega está en Operaciones. Solicita su devolución para corregirla.",
      );
    if (
      ["execution", "completed"].includes(data.stage) &&
      !req.session.user.permissions.includes("works_manage")
    )
      throw new ForbiddenException(
        "El inicio y cierre de obra corresponden a Operaciones.",
      );
    return this.crm.update(id, data, req.session.user.username, {
      user: req.session.user,
    });
  }
  @Post("leads/:id/notes") note(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z
        .object({
          version: z.number().int().positive(),
          text: z.string().trim().min(1).max(4000),
        })
        .strict(),
      body,
    );
    return this.crm.note(
      id,
      data.version,
      data.text,
      req.session.user.username,
    );
  }
  @Post("leads/:id/files")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    return this.files.upload(id, file, photoMetadataFromForm(body));
  }

  @Get("files/:id") async read(@Param("id") id: string, @Res() res: Response) {
    const { doc, file } = await this.files.read(id);
    res.set({
      "Content-Type": doc.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${doc.type === "contract" ? "attachment" : "inline"}; filename="${doc.type === "contract" ? "contrato.pdf" : "foto.webp"}"`,
    });
    (file.Body as Readable).pipe(res);
  }
  @RequirePermission("inventory")
  @Get("materials")
  materials(@Query("search") search = "") {
    return this.inventory.list(search);
  }
  @RequirePermission("inventory")
  @Get("materials/:id")
  material(@Param("id") id: string) {
    return this.inventory.detail(id);
  }
  @Post("materials")
  @RequirePermission("inventory_catalog", "inventory")
  createMaterial(@Body() body: unknown) {
    return this.inventory.create(body);
  }
  @RequirePermission("inventory")
  @Get("movements")
  movements(
    @Query("leadId") leadId?: string,
    @Query("materialId") materialId?: string,
    @Query("page") page = "1",
  ) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > 10000)
      throw new BadRequestException("Página inválida.");
    return this.inventory.movements(leadId, materialId, p);
  }
  @RequirePermission("inventory")
  @Post("materials/:id/movements")
  move(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(movementSchema, body);
    const permission =
      data.kind === "receipt"
        ? "inventory_receive"
        : data.kind === "return"
          ? "inventory_receive"
          : "works_manage";
    if (!req.session.user.permissions.includes(permission))
      throw new ForbiddenException();
    const action = () =>
      this.inventory.move(id, data, req.session.user.username);
    return data.leadId
      ? this.gate.run(data.leadId, `movement:${data.operationId}`, action, true)
      : action();
  }
}
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    ConsultationController,
    CrmController,
    WorksController,
    WorkHandoffController,
    WorkTasksController,
    WorkStageController,
    GalleryController,
    MobileGalleryController,
  ],
  exports: [
    CrmRepository,
    CrmService,
    InventoryService,
    SupplyDispatches,
    WorkGate,
    WorkReadiness,
    WorkAccess,
    CrmEvents,
  ],
  providers: [
    WorkNotifications,
    WorkStageRequests,
    CrmRepository,
    CrmService,
    WorkAccess,
    CrmFiles,
    InventoryService,
    SupplyDispatches,
    WorkGate,
    WorkReadiness,
    CrmEvents,
    GalleryService,
    GalleryUploads,
    MobileGalleryAccess,
  ],
})
export class CrmModule {}
