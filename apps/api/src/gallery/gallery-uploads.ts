import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  categoryIds,
  GALLERY_PHOTO_MAX_BYTES,
  GALLERY_PHOTO_NAME_MAX,
  type GalleryUploadPhoto,
} from "@veca/content";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { parse } from "../common/validation";
import { Database } from "../database/database.module";
import { StorageService } from "../media/storage.service";

export const GalleryPhotoFile = FileInterceptor("file", {
  limits: {
    fileSize: GALLERY_PHOTO_MAX_BYTES + 1,
    files: 1,
    fields: 3,
    fieldSize: 1024,
  },
});

const uploadSchema = z
  .object({
    submissionId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1, "Escribe un nombre para la foto.")
      .max(
        GALLERY_PHOTO_NAME_MAX,
        "El nombre debe tener hasta 120 caracteres.",
      ),
    category: z.enum(categoryIds, {
      error: "Selecciona una categoría de VECA.",
    }),
  })
  .strict();

export type GalleryUploadDocument = Omit<
  z.infer<typeof uploadSchema>,
  "submissionId"
> & {
  _id: ObjectId;
  createdAt: string;
  uploadedBy: string;
};

@Injectable()
export class GalleryUploads {
  constructor(
    private readonly database: Database,
    private readonly storage: StorageService,
  ) {}

  get collection() {
    return this.database.db.collection<GalleryUploadDocument>(
      "gallery_uploads",
    );
  }

  view({
    _id,
    name,
    category,
    createdAt,
  }: GalleryUploadDocument): GalleryUploadPhoto {
    const id = _id.toHexString();
    return {
      source: "upload",
      id,
      name,
      category,
      createdAt,
      url: `/admin/gallery/photos/${id}`,
    };
  }

  async create(
    file: Express.Multer.File | undefined,
    body: unknown,
    actor: string,
  ) {
    const { submissionId, ...data } = parse(uploadSchema, body);
    if (!file) throw new BadRequestException("Selecciona una foto.");
    if (file.size > GALLERY_PHOTO_MAX_BYTES)
      throw new PayloadTooLargeException("La foto debe pesar hasta 12 MB.");
    // A retry uses the same object and document. Changes to the photo or its
    // details get a different ID, even if a client reuses the submission ID.
    const id = new ObjectId(
      createHash("sha256")
        .update(JSON.stringify([actor, submissionId, data.name, data.category]))
        .update(file.buffer)
        .digest()
        .subarray(0, 12),
    );
    const saved = await this.collection.findOne({ _id: id });
    if (saved) return this.view(saved);
    let buffer: Buffer;
    try {
      const image = sharp(file.buffer, {
        limitInputPixels: 40_000_000,
        failOn: "error",
      });
      const { format, compression } = await image.metadata();
      const avif = format === "heif" && compression === "av1";
      if (!avif && format !== "jpeg" && format !== "png" && format !== "webp")
        throw new Error("Unsupported gallery photo format");
      buffer = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 86 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        "Sube una foto JPG, PNG, WebP o AVIF de hasta 12 MB y 40 megapíxeles.",
      );
    }
    const doc: GalleryUploadDocument = {
      ...data,
      _id: id,
      createdAt: new Date().toISOString(),
      uploadedBy: actor,
    };
    await this.storage.put(this.key(id), buffer);
    const stored = await this.collection.findOneAndUpdate(
      { _id: id },
      { $setOnInsert: doc },
      { upsert: true, returnDocument: "after" },
    );
    if (!stored) throw new InternalServerErrorException();
    return this.view(stored);
  }

  async read(id: ObjectId) {
    if (
      !(await this.collection.findOne({ _id: id }, { projection: { _id: 1 } }))
    )
      throw new NotFoundException();
    return this.storage.get(this.key(id));
  }

  private key(id: ObjectId) {
    return `veca/gallery/${id.toHexString()}.webp`;
  }
}
