import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  PHOTO_TAGS,
  categoryIds,
  photoMetadataSchema,
  requestSchema,
  segmentSchema,
  stageSchema,
  type GalleryLeadPhoto,
  type GalleryPublicationPhoto,
  type GalleryPage,
} from "@veca/content";
import { parse } from "../common/validation";
import { CrmFiles, type AttachmentDocument } from "../crm/crm.files";
import { publicationPhotos } from "./publication-photos";
import { GalleryUploads, type GalleryUploadDocument } from "./gallery-uploads";
const filtersSchema = z
  .object({
    search: z.string().trim().max(120).default(""),
    sharing: z.enum(["", "internal", "clients"]).default(""),
    tag: z.union([z.literal(""), z.enum(PHOTO_TAGS)]).default(""),
    stage: z.union([z.literal(""), stageSchema]).default(""),
    segment: z.union([z.literal(""), segmentSchema]).default(""),
    requestType: z.union([z.literal(""), requestSchema]).default(""),
    source: z.enum(["", "lead", "publication", "upload"]).default(""),
    status: z.enum(["", "draft", "published"]).default(""),
    category: z.union([z.literal(""), z.enum(categoryIds)]).default(""),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
const updateSchema = photoMetadataSchema
  .extend({ revision: z.number().int().min(0) })
  .strict();
type JoinedPhoto = AttachmentDocument & {
  source: "lead";
  lead: GalleryLeadPhoto["lead"];
};
@Injectable()
export class GalleryService {
  constructor(
    private readonly files: CrmFiles,
    private readonly uploads: GalleryUploads,
  ) {}
  view(doc: JoinedPhoto): GalleryLeadPhoto {
    return {
      ...this.files.view(doc),
      source: "lead",
      url: `/admin/gallery/photos/${doc._id}`,
      lead: doc.lead,
    };
  }
  async list(query: unknown, includeDrafts: boolean): Promise<GalleryPage> {
    const data = parse(filtersSchema, query);
    const leadOnly = Boolean(
      data.sharing ||
      data.tag ||
      data.stage ||
      data.segment ||
      data.requestType,
    );
    const includeLeads =
      (!data.source || data.source === "lead") &&
      !data.status &&
      !data.category;
    const includePublications =
      (!data.source || data.source === "publication") && !leadOnly;
    const includeUploads =
      (!data.source || data.source === "upload") && !leadOnly && !data.status;
    const match: Record<string, unknown> = { type: "photo" };
    if (!includeLeads) match._id = { $exists: false };
    if (data.sharing === "internal") match.sharing = { $ne: "clients" };
    if (data.sharing === "clients") match.sharing = "clients";
    if (data.tag) match.tags = data.tag;
    const after: Record<string, unknown> = {};
    for (const field of ["stage", "segment", "requestType"] as const)
      if (data[field]) after[`lead.${field}`] = data[field];
    const publicationMatch: Record<string, unknown> = {};
    const uploadMatch: Record<string, unknown> = {};
    if (data.status) publicationMatch["publication.status"] = data.status;
    if (data.category) {
      publicationMatch["publication.category"] = data.category;
      uploadMatch.category = data.category;
    }
    if (data.search) {
      const regex = data.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      uploadMatch.name = { $regex: regex, $options: "i" };
      after.$or = ["caption", "name", "lead.name", "lead.district"].map(
        (field) => ({ [field]: { $regex: regex, $options: "i" } }),
      );
      publicationMatch.$or = [
        "caption",
        "alt",
        "publication.title",
        "publication.location",
      ].map((field) => ({ [field]: { $regex: regex, $options: "i" } }));
    }
    const [result] = await this.files.collection
      .aggregate<{
        items: (
          | JoinedPhoto
          | GalleryPublicationPhoto
          | (GalleryUploadDocument & { source: "upload" })
        )[];
        count: { total: number }[];
      }>(
        [
          { $match: match },
          {
            $addFields: {
              leadObjectId: {
                $convert: {
                  input: "$leadId",
                  to: "objectId",
                  onError: null,
                  onNull: null,
                },
              },
            },
          },
          {
            $lookup: {
              from: "crm_leads",
              localField: "leadObjectId",
              foreignField: "_id",
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: { $toString: "$_id" },
                    name: 1,
                    district: 1,
                    requestType: 1,
                    stage: 1,
                    segment: 1,
                  },
                },
              ],
              as: "lead",
            },
          },
          { $unwind: "$lead" },
          { $match: after },
          { $set: { source: "lead" } },
          ...(includePublications
            ? [
                {
                  $unionWith: {
                    coll: "projects",
                    pipeline: [
                      ...publicationPhotos(includeDrafts),
                      { $match: publicationMatch },
                    ],
                  },
                },
              ]
            : []),
          ...(includeUploads
            ? [
                {
                  $unionWith: {
                    coll: this.uploads.collection.collectionName,
                    pipeline: [
                      { $match: uploadMatch },
                      { $set: { source: "upload" } },
                    ],
                  },
                },
              ]
            : []),
          {
            $facet: {
              items: [
                {
                  $sort: {
                    createdAt: data.sort === "oldest" ? 1 : -1,
                    originId: 1,
                    "publication.cover": -1,
                    position: 1,
                    id: 1,
                    _id: -1,
                  },
                },
                { $skip: (data.page - 1) * 36 },
                { $limit: 36 },
              ],
              count: [{ $count: "total" }],
            },
          },
        ],
        { maxTimeMS: 5000 },
      )
      .toArray();
    const total = result?.count[0]?.total || 0;
    return {
      items: (result?.items || []).map((photo) => {
        if (photo.source === "lead") return this.view(photo);
        if (photo.source === "upload") return this.uploads.view(photo);
        const { id, source, url, caption, alt, createdAt, publication } = photo;
        return { id, source, url, caption, alt, createdAt, publication };
      }),
      total,
      page: data.page,
      pages: Math.ceil(total / 36),
    };
  }
  async update(id: string, input: unknown, actor: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    const { revision, ...data } = parse(updateSchema, input);
    const doc = await this.files.collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        type: "photo",
        ...(revision === 0
          ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
          : { revision }),
      },
      {
        $set: {
          ...data,
          updatedAt: new Date().toISOString(),
          updatedBy: actor,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    if (!doc)
      throw new ConflictException(
        "La foto cambió en otra ventana o ya no está disponible. Cierra y recarga la galería.",
      );
    return this.files.view(doc);
  }
  async read(id: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    // Check the kind before retrieving an object: gallery permission never grants access to contracts.
    const photoId = new ObjectId(id);
    const leadPhoto = await this.files.collection.findOne({
      _id: photoId,
      type: "photo",
    });
    if (leadPhoto) return (await this.files.read(id)).file;
    return this.uploads.read(photoId);
  }
}
