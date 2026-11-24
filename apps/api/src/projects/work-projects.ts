import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import sharp from "sharp";
import { z } from "zod";
import type { Response } from "express";
import {
  emptyProject,
  formatPeruLocation,
  matchPeruLocation,
  type CompletedWorkSource,
  type Media,
} from "@veca/content";
import type { LeadDocument } from "../crm/crm.repository";
import type { AttachmentDocument } from "../crm/crm.files";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { RequirePermission } from "../auth/route-access";
import { Database } from "../database/database.module";
import { config } from "../common/config";
import { parse } from "../common/validation";
import { literalSearch } from "../common/literal-search";
import { StorageService } from "../media/storage.service";
import { ProjectsService } from "./projects.service";
import { ProjectsRepository } from "./projects.repository";

const creation = z
  .object({
    operationId: z.uuid(),
    version: z.number().int().positive(),
    photoIds: z
      .array(z.string().regex(/^[a-f\d]{24}$/i))
      .min(1)
      .max(24)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

@Injectable()
export class WorkProjects {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly repo: ProjectsRepository,
  ) {}
  private async work(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException("Obra no encontrada.");
    const work = await this.db.db
      .collection<LeadDocument>("crm_leads")
      .findOne({ _id: new ObjectId(id), stage: "completed" });
    if (!work)
      throw new NotFoundException(
        "La obra debe estar realizada para preparar su publicación.",
      );
    return work;
  }
  private view(work: LeadDocument): CompletedWorkSource {
    return {
      id: String(work._id),
      version: work.version,
      name: work.workName || work.name,
      location: work.workLocation || work.district,
      plan: work.workPlan,
      result: work.completionNote,
      completedAt: work.completedAt || null,
    };
  }
  async list(input: unknown) {
    const filters = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          search: z.string().trim().max(120).default(""),
        })
        .strict(),
      input,
    );
    const pattern = literalSearch(filters.search);
    const match = {
      stage: "completed" as const,
      ...(pattern
        ? {
            $or: ["name", "workName", "workLocation", "district"].map(
              (field) => ({ [field]: { $regex: pattern, $options: "i" } }),
            ),
          }
        : {}),
    };
    const works = this.db.db.collection<LeadDocument>("crm_leads");
    const [rows, total] = await Promise.all([
      works
        .find(match)
        .sort({ completedAt: -1, _id: -1 })
        .skip((filters.page - 1) * 6)
        .limit(6)
        .toArray(),
      works.countDocuments(match),
    ]);
    const drafts = await this.repo.collection
      .find({ "sourceWork.id": { $in: rows.map((r) => String(r._id)) } })
      .sort({ createdAt: -1 })
      .toArray();
    return {
      items: rows.map((r) => {
        const project = drafts.find((p) => p.sourceWork?.id === String(r._id));
        return {
          ...this.view(r),
          ...(project
            ? {
                project: {
                  id: String(project._id),
                  title: project.draft.title,
                  status: project.published ? "published" : "draft",
                },
              }
            : {}),
        };
      }),
      total,
      page: filters.page,
      pages: Math.ceil(total / 6),
    };
  }
  async detail(id: string) {
    const work = await this.work(id);
    const photos = await this.db.db
      .collection<AttachmentDocument>("crm_files")
      .find({ leadId: id, type: "photo" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .toArray();
    return {
      work: this.view(work),
      photos: photos.map((p) => ({
        id: String(p._id),
        caption: p.caption || "",
        tags: p.tags || [],
        url: `/admin/project-sources/works/${id}/photos/${p._id}`,
      })),
    };
  }
  async photo(workId: string, photoId: string) {
    await this.work(workId);
    if (!ObjectId.isValid(photoId)) throw new NotFoundException();
    const photo = await this.db.db
      .collection<AttachmentDocument>("crm_files")
      .findOne({ _id: new ObjectId(photoId), leadId: workId, type: "photo" });
    if (!photo) throw new NotFoundException("Foto no encontrada en esta obra.");
    return photo;
  }
  private async media(
    photo: AttachmentDocument,
    work: CompletedWorkSource,
    index: number,
  ): Promise<Media> {
    const url = `${config.PUBLIC_API_URL}/media/${photo._id}`;
    const collection = this.db.db.collection("media");
    const existing = await collection.findOne({ _id: photo._id });
    if (
      existing &&
      (existing.key !== photo.key || existing.sourceWorkId !== work.id)
    )
      throw new ConflictException(
        "No pudimos reutilizar esta foto. Vuelve a abrir la selección.",
      );
    let width = existing?.width,
      height = existing?.height;
    if (!width || !height) {
      const object = await this.storage.get(photo.key);
      if (!object.Body)
        throw new NotFoundException("La foto ya no está disponible.");
      const metadata = await sharp(
        await object.Body.transformToByteArray(),
      ).metadata();
      width = metadata.width;
      height = metadata.height;
      if (!width || !height)
        throw new BadRequestException(
          "Esta foto no se puede utilizar en el proyecto.",
        );
      await collection.updateOne(
        { _id: photo._id },
        {
          $setOnInsert: {
            key: photo.key,
            sourceWorkId: work.id,
            sourcePhotoId: String(photo._id),
            width,
            height,
            url,
            status: "ready",
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
    return {
      id: String(photo._id),
      url,
      width,
      height,
      alt: (photo.caption || `${work.name} · Foto ${index + 1}`).slice(0, 220),
      caption: (photo.caption || "").slice(0, 400),
      positionX: 50,
      positionY: 50,
    };
  }
  async create(id: string, input: unknown, userId: string) {
    const data = parse(creation, input);
    const operationId = userId + ":" + data.operationId;
    const hash = createHash("sha256")
      .update(JSON.stringify({ work: id, photos: data.photoIds }))
      .digest("hex");
    const previous = await this.repo.collection.findOne({
      sourceOperationId: operationId,
    });
    if (previous) {
      if (previous.sourceOperationHash !== hash)
        throw new ConflictException(
          "Este borrador ya se preparó con otra selección de fotos.",
        );
      return this.projects.admin(previous);
    }
    const work = await this.work(id);
    if (work.version !== data.version)
      throw new ConflictException(
        "La obra cambió. Vuelve a abrir la selección antes de crear el borrador.",
      );
    const source = this.view(work),
      match = matchPeruLocation(source.location);
    if (!match)
      throw new BadRequestException(
        "Completa la ubicación de la obra antes de preparar el proyecto.",
      );
    source.location = formatPeruLocation(match.region, match.locality);
    const images: Media[] = [];
    // Reuse the stored objects. Bound metadata reads to four photos at a time.
    for (let start = 0; start < data.photoIds.length; start += 4) {
      const batch = await Promise.all(
        data.photoIds
          .slice(start, start + 4)
          .map(async (photoId, offset) =>
            this.media(await this.photo(id, photoId), source, start + offset),
          ),
      );
      images.push(...batch);
    }
    const current = await this.work(id);
    if (current.version !== data.version)
      throw new ConflictException(
        "La obra cambió mientras se preparaban las fotos. Vuelve a abrir la selección.",
      );
    return this.projects.create(
      {
        ...emptyProject(),
        title: source.name.length >= 4 ? source.name : "Obra de " + source.name,
        location: source.location,
        category:
          work.requestType === "building"
            ? "edificios"
            : work.requestType === "repair"
              ? "remodelaciones"
              : "viviendas",
        images,
        coverId: images[0].id,
        pageLayout: "stacked",
        sections: [
          {
            id: "work-photos",
            title: "",
            body: { type: "doc", content: [{ type: "paragraph" }] },
            imageIds: images.map((image) => image.id),
          },
        ],
      },
      {
        sourceWork: { id, name: source.name, location: source.location },
        sourceOperationId: operationId,
        sourceOperationHash: hash,
      },
    );
  }
}

@Controller("admin/project-sources/works")
@RequirePermission("projects")
export class WorkProjectsController {
  constructor(
    private readonly sources: WorkProjects,
    private readonly storage: StorageService,
  ) {}
  @Get() list(@Query() input: unknown) {
    return this.sources.list(input);
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.sources.detail(id);
  }
  @Get(":id/photos/:photoId") async photo(
    @Param("id") id: string,
    @Param("photoId") photoId: string,
    @Res() res: Response,
  ) {
    const photo = await this.sources.photo(id, photoId),
      object = await this.storage.get(photo.key);
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    (object.Body as Readable).pipe(res);
  }
  @Post(":id/draft") create(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sources.create(id, input, req.session.user.id);
  }
}
