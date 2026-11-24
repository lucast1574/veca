import {
  Controller,
  Sse,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Body,
  Post,
  Put,
  ForbiddenException,
  ConflictException,
  Get,
  Param,
  Query,
  Req,
  Res,
  NotFoundException,
} from "@nestjs/common";
import type { Response } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { workTeamSchema, leadUpdateSchema } from "@veca/content";
import { RequirePermission } from "../auth/route-access";
import { parse } from "../common/validation";
import { literalSearch } from "../common/literal-search";
import { CrmRepository } from "./crm.repository";
import { FileInterceptor } from "@nestjs/platform-express";
import { CrmFiles, photoMetadataFromForm } from "./crm.files";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { CrmEvents } from "./crm.events";
import { WorkAccess } from "./work-access.service";
import { CrmService } from "./crm.service";
import { InventoryService } from "../inventory/inventory.service";

const stages = ["coordination", "execution", "completed"] as const;
const filters = z
  .object({
    search: z.string().trim().max(120).default(""),
    stage: z.enum(["", ...stages]).default(""),
    mine: z.enum(["", "true"]).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();

@Controller("admin/works")
@RequirePermission("works")
export class WorksController {
  constructor(
    private readonly crm: CrmRepository,
    private readonly files: CrmFiles,
    private readonly inventory: InventoryService,
    private readonly access: WorkAccess,
    private readonly service: CrmService,
    private readonly events: CrmEvents,
  ) {}

  @Get()
  async list(@Query() input: unknown, @Req() req: AuthenticatedRequest) {
    const { search, stage, page, mine } = parse(filters, input);
    const pattern = literalSearch(search);
    const match = {
      $and: [
        this.access.scope(req.session.user, mine === "true"),
        { stage: { $in: stage ? [stage] : [...stages] } },
      ],
      ...(pattern
        ? {
            $or: [
              "name",
              "workName",
              "workLocation",
              "district",
              "address",
              "assignedTo",
            ].map((field) => ({
              [field]: { $regex: pattern, $options: "i" },
            })),
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.crm.collection
        .find(match)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * 24)
        .limit(24)
        .toArray(),
      this.crm.collection.countDocuments(match),
    ]);
    return {
      items: rows.map((row) => this.crm.view(row)),
      total,
      page,
      pages: Math.ceil(total / 24),
    };
  }

  @Sse("events")
  stream() {
    return this.events.stream;
  }

  @Get("people")
  @RequirePermission("works_manage", "works")
  people() {
    return this.access.people();
  }

  @Put(":id/team")
  @RequirePermission("works_manage", "works")
  assign(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z
        .object({ version: z.number().int().positive(), team: workTeamSchema })
        .strict(),
      body,
    );
    return this.access.assign(id, data.version, data.team, req.session.user);
  }

  @Post(":id/handoff")
  @RequirePermission("works_manage", "works")
  decide(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z
        .object({
          version: z.number().int().positive(),
          action: z.enum(["accepted", "returned"]),
          observation: z.string().trim().max(1000).default(""),
        })
        .strict()
        .refine(
          (data) => data.action !== "returned" || data.observation.length >= 5,
          "Indica qué debe completar Comercial.",
        ),
      body,
    );
    return this.access.decide(
      id,
      data.version,
      data.action,
      data.observation,
      req.session.user,
    );
  }

  @Put(":id")
  @RequirePermission("works_manage", "works")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.get(id, req.session.user);
    const data = parse(leadUpdateSchema, body);
    if (!stages.some((stage) => stage === data.stage))
      throw new ForbiddenException(
        "Gestiona el seguimiento comercial desde Leads.",
      );
    return this.service.update(id, data, req.session.user.username, {
      user: req.session.user,
    });
  }

  @Post(":id/notes")
  async note(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.session.user;
    const row = await this.access.get(id, user);
    if (
      !user.permissions.some(
        (p) => p === "works_manage" || p === "works_report",
      )
    )
      throw new ForbiddenException();
    if (row.workHandoff && row.workHandoff.status !== "accepted")
      throw new ConflictException(
        "El coordinador debe aceptar primero la entrega.",
      );
    const data = parse(
      z
        .object({
          version: z.number().int().positive(),
          text: z.string().trim().min(1).max(4000),
        })
        .strict(),
      body,
    );
    return this.service.note(id, data.version, data.text, user.username);
  }

  @Post(":id/files")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  async upload(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.session.user;
    const row = await this.access.get(id, user);
    if (
      !user.permissions.some(
        (p) => p === "works_manage" || p === "works_report",
      )
    )
      throw new ForbiddenException();
    if (row.workHandoff && row.workHandoff.status !== "accepted")
      throw new ConflictException(
        "El coordinador debe aceptar primero la entrega.",
      );
    const metadata = photoMetadataFromForm(body);
    if (!user.permissions.includes("works_manage")) {
      if (!file || file.buffer.subarray(0, 5).toString() === "%PDF-")
        throw new BadRequestException("Selecciona una foto de avance.");
      metadata.sharing = "internal";
    }
    const saved = await this.files.upload(id, file, metadata);
    return { ...saved, url: `/admin/works/${id}/files/${saved.id}` };
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const row = await this.access.get(id, req.session.user);
    const attachments = (await this.files.list(id))
      .filter(
        (file) =>
          file.type === "photo" ||
          req.session.user.permissions.some(
            (p) => p === "works_all" || p === "works_manage",
          ),
      )
      .map((file) => ({
        ...file,
        url: `/admin/works/${id}/files/${file.id}`,
      }));
    return {
      lead: this.crm.view(row),
      attachments,
      movements: req.session.user.permissions.includes("inventory")
        ? await this.inventory.movements(id)
        : [],
    };
  }

  @Get(":id/files/:fileId")
  async file(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Res() res: Response,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.get(id, req.session.user);
    const document = await this.files.collection.findOne({
      _id: this.crm.id(fileId),
      leadId: id,
    });
    if (
      !document ||
      (document.type === "contract" &&
        !req.session.user.permissions.some(
          (p) => p === "works_all" || p === "works_manage",
        ))
    )
      throw new NotFoundException();
    const { doc, file } = await this.files.read(fileId);
    if (doc.leadId !== id) throw new NotFoundException();
    res.set({
      "Content-Type": doc.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition":
        doc.type === "contract"
          ? 'attachment; filename="contrato.pdf"'
          : 'inline; filename="foto.webp"',
    });
    (file.Body as Readable).pipe(res);
  }
}
