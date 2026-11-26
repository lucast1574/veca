import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ACCOUNTING_PROOF_MAX_BYTES } from "@veca/content";
import type { StorageService } from "../media/storage.service";

export async function readAccountingProof(
  storage: StorageService,
  key?: string,
) {
  if (!key) throw new NotFoundException("El registro aún no tiene sustento.");
  return {
    file: await storage.get(key),
    pdf: key.endsWith(".pdf"),
  };
}

export async function storeAccountingProof(
  storage: StorageService,
  directory: string,
  file: Express.Multer.File | undefined,
) {
  const invalid = () =>
    new BadRequestException(
      "Adjunta una foto JPG, PNG o WebP, o un PDF de hasta 8 MB.",
    );
  if (
    !file ||
    !file.buffer.length ||
    file.buffer.length > ACCOUNTING_PROOF_MAX_BYTES
  )
    throw invalid();
  const pdf = file.buffer.subarray(0, 5).toString() === "%PDF-";
  let body = file.buffer;
  if (!pdf) {
    try {
      const image = sharp(body, {
        limitInputPixels: 40_000_000,
        failOn: "error",
      });
      const { format } = await image.metadata();
      if (!format || !["jpeg", "png", "webp"].includes(format)) throw invalid();
      body = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw invalid();
    }
  }
  const key = `${directory}/${randomUUID()}.${pdf ? "pdf" : "webp"}`;
  await storage.put(key, body, pdf ? "application/pdf" : "image/webp");
  return key;
}
