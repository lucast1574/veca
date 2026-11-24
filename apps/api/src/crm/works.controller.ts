import {
  Controller,
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
import { RequirePermission } from "../auth/route-access";
import { parse } from "../common/validation";
import { literalSearch } from "../common/literal-search";
import { CrmRepository } from "./crm.repository";
import { CrmFiles } from "./crm.files";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { InventoryService } from "../inventory/inventory.service";

const stages = ["coordination", "execution", "completed"] as const;
const filters = z
  .object({
    search: z.string().trim().max(120).default(""),
    stage: z.enum(["", ...stages]).default(""),
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
  ) {}

  @Get()
  async list(@Query() input: unknown) {
    const { search, stage, page } = parse(filters, input);
    const pattern = literalSearch(search);
    const match = {
      stage: { $in: stage ? [stage] : [...stages] },
      ...(pattern
        ? {
            $or: ["name", "district", "address", "assignedTo"].map((field) => ({
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

  private async work(id: string) {
    const row = await this.crm.get(id);
    if (!stages.some((stage) => stage === row.stage))
      throw new NotFoundException("Obra no encontrada.");
    return row;
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const row = await this.work(id);
    const attachments = (await this.files.list(id)).map((file) => ({
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
  ) {
    await this.work(id);
    const document = await this.files.collection.findOne({
      _id: this.crm.id(fileId),
      leadId: id,
    });
    if (!document) throw new NotFoundException();
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
