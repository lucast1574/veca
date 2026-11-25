import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { z } from "zod";
import { photoMetadataSchema, quotationSchema } from "@veca/content";
import { parse } from "../common/validation";
import { Database } from "../database/database.module";
import { StorageService } from "../media/storage.service";
import { CrmRepository } from "./crm.repository";
import type { LeadAttachment, PhotoMetadata } from "@veca/content";
export type AttachmentDocument = Omit<LeadAttachment, "id" | "url"> & {
  _id: ObjectId;
  key: string;
  mime: string;
};
export function photoMetadataFromForm(body: Record<string, unknown>) {
  let tags: unknown = [];
  if (body.tags !== undefined) {
    try {
      tags = JSON.parse(String(body.tags));
    } catch {
      throw new BadRequestException("Etiquetas inválidas.");
    }
  }
  const { documentType: _purpose, quotation: _quotation, ...photo } = body;
  return parse(photoMetadataSchema, { ...photo, tags });
}
export function documentMetadataFromForm(body: Record<string, unknown>) {
  if (body.documentType === undefined && body.quotation === undefined)
    return undefined;
  const type = parse(z.enum(["plan", "quotation"]), body.documentType);
  let quotation: unknown;
  if (body.quotation !== undefined) {
    try {
      quotation = JSON.parse(String(body.quotation));
    } catch {
      throw new BadRequestException("Revisa los valores de la cotización.");
    }
  }
  if (type === "plan" && quotation !== undefined)
    throw new BadRequestException("Un plano no lleva importes de cotización.");
  return {
    type,
    ...(type === "quotation"
      ? { quotation: parse(quotationSchema, quotation) }
      : {}),
  };
}
export function attachmentDisposition(
  doc: Pick<AttachmentDocument, "type" | "name" | "mime">,
) {
  if (doc.type === "contract") return 'attachment; filename="contrato.pdf"';
  if (doc.type === "photo") return 'inline; filename="foto.webp"';
  const fallback =
    doc.mime === "application/pdf" ? "documento.pdf" : "imagen.webp";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`;
}
@Injectable()
export class CrmFiles {
  constructor(
    private readonly database: Database,
    private readonly storage: StorageService,
    private readonly leads: CrmRepository,
  ) {}
  get collection() {
    return this.database.db.collection<AttachmentDocument>("crm_files");
  }
  view(d: AttachmentDocument): LeadAttachment {
    return {
      id: String(d._id),
      leadId: d.leadId,
      name: d.name,
      type: d.type,
      caption: d.caption,
      createdAt: d.createdAt,
      tags: d.tags || [],
      sharing: d.sharing || "internal",
      revision: d.revision || 0,
      ...(d.quotation ? { quotation: d.quotation } : {}),
      url: `/admin/crm/files/${d._id}`,
    };
  }
  async list(leadId: string) {
    leadId = String((await this.leads.get(leadId))._id);
    const [recent, plans, quotations] = await Promise.all([
      this.collection
        .find({ leadId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(100)
        .toArray(),
      this.collection
        .find({ leadId, type: "plan" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .toArray(),
      this.collection
        .find({ leadId, type: "quotation" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .toArray(),
    ]);
    return [
      ...new Map(
        [...recent, ...plans, ...quotations].map((d) => [String(d._id), d]),
      ).values(),
    ]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          String(b._id).localeCompare(String(a._id)),
      )
      .map((d) => this.view(d));
  }

  async upload(
    leadId: string,
    file: Express.Multer.File,
    metadata: PhotoMetadata,
    document?: ReturnType<typeof documentMetadataFromForm>,
  ) {
    leadId = String((await this.leads.get(leadId))._id);
    if (!file)
      throw new BadRequestException("Selecciona un archivo PDF o una imagen.");
    const pdf = file.buffer.subarray(0, 5).toString() === "%PDF-";
    let body = file.buffer;
    let mime = pdf ? "application/pdf" : "image/webp";
    let extension = pdf ? "pdf" : "webp";
    if (!pdf) {
      try {
        const image = sharp(file.buffer, {
          limitInputPixels: 40_000_000,
          animated: false,
          failOn: "error",
        });
        const meta = await image.metadata();
        if (!["jpeg", "png", "webp", "avif"].includes(meta.format || ""))
          throw Error();
        const optimized = await image
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
        if (document) {
          mime = `image/${meta.format}`;
          extension = meta.format === "jpeg" ? "jpg" : meta.format!;
        } else body = optimized;
      } catch {
        throw new BadRequestException(
          "Sube fotos JPG, PNG, WebP o AVIF, o un contrato PDF de hasta 12 MB.",
        );
      }
    }
    const id = new ObjectId();
    const originalName =
      file.originalname.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 150) ||
      "Archivo";
    const doc: AttachmentDocument = {
      _id: id,
      leadId,
      name: document
        ? `${originalName.replace(/\.(pdf|jpe?g|png|webp|avif)$/i, "")}.${extension}`
        : originalName,
      type: document?.type || (pdf ? "contract" : "photo"),
      ...(document?.quotation
        ? { quotation: parse(quotationSchema, document.quotation) }
        : {}),
      caption: String(metadata.caption || "")
        .trim()
        .slice(0, 500),
      tags: pdf || document ? [] : metadata.tags,
      sharing: pdf || document ? "internal" : metadata.sharing,
      revision: 1,
      createdAt: new Date().toISOString(),
      key: `veca/leads/${leadId}/${id}.${extension}`,
      mime,
    };
    await this.storage.put(doc.key, body, doc.mime);
    await this.collection.insertOne(doc);
    return this.view(doc);
  }
  async read(id: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    if (!doc) throw new NotFoundException();
    return { doc, file: await this.storage.get(doc.key) };
  }
}
