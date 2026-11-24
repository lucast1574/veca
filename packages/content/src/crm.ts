import { z } from "zod";
import type { ProjectInput } from "./index.js";
export const LEAD_STAGES = [
  { id: "prelead", name: "Por contactar" },
  { id: "contacted", name: "Contacto registrado" },
  { id: "coordination", name: "Coordinación" },
  { id: "execution", name: "Obra en ejecución" },
  { id: "completed", name: "Obra realizada" },
  { id: "discarded", name: "Descartado" },
] as const;
export const LEAD_SEGMENTS = [
  {
    id: "high",
    name: "Proyectos residenciales",
    description: "Viviendas de lujo y remodelaciones de mayor valor",
  },
  {
    id: "low",
    name: "Arreglos y mejoras del hogar",
    description: "Arreglos y viviendas pequeñas",
  },
  {
    id: "large",
    name: "Obras grandes",
    description: "Edificios y proyectos de gran escala",
  },
] as const;
export const REQUEST_TYPES = [
  {
    id: "repair",
    name: "Arreglo o reemplazo",
    description: "Una ventana, un vidrio o un detalle puntual",
    segment: "low",
  },
  {
    id: "home",
    name: "Casa o departamento",
    description: "Mejoras y soluciones para tu hogar",
    segment: "low",
  },
  {
    id: "premium",
    name: "Residencia o remodelación integral",
    description: "Un proyecto residencial de mayor alcance",
    segment: "high",
  },
  {
    id: "building",
    name: "Edificio u obra de gran escala",
    description: "Fachadas y proyectos inmobiliarios",
    segment: "large",
  },
] as const;
export const stageSchema = z.enum([
  "prelead",
  "contacted",
  "coordination",
  "execution",
  "completed",
  "discarded",
]);
export const segmentSchema = z.enum(["high", "low", "large"]);
export const requestSchema = z.enum(["repair", "home", "premium", "building"]);
const text = (max: number) => z.string().trim().max(max);
const contactFields = {
  name: text(100).min(2, "Escribe tu nombre."),
  email: text(180)
    .email("Escribe un correo válido.")
    .or(z.literal(""))
    .default(""),
  phone: text(30)
    .regex(/^\+?[\d ()-]{7,30}$/, "Escribe un teléfono válido.")
    .refine(
      (value) => value.replace(/\D/g, "").length >= 7,
      "Escribe un teléfono válido.",
    )
    .or(z.literal(""))
    .default(""),
};
export const leadWorkSchema = z.object({
  district: text(120).min(2, "Indica el distrito."),
  requestType: requestSchema,
  idea: text(4000).min(10, "Cuéntanos un poco más de tu proyecto."),
});
const intakeFields = {
  ...contactFields,
  requestType: requestSchema.or(z.literal("")).default(""),
  idea: text(4000).default(""),
  submissionId: z.string().uuid(),
  website: text(200).optional().default(""),
};
const hasContact = ({ phone, email }: { phone: string; email: string }) =>
  Boolean(phone || email);
const contactError = {
  message: "Indica un teléfono o un correo electrónico.",
  path: ["phone"],
};
export const SOCIAL_CHANNELS = ["facebook", "instagram", "linkedin"] as const;
export const socialChannelSchema = z.enum(SOCIAL_CHANNELS);
export type SocialChannel = z.infer<typeof socialChannelSchema>;
export const LEAD_SOURCE_LABELS = {
  web: "Web",
  manual: "Equipo",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
} as const;
export const socialLeadSchema = z
  .object({
    ...intakeFields,
    idea: leadWorkSchema.shape.idea.or(z.literal("")).default(""),
    source: socialChannelSchema,
  })
  .strict()
  .refine(hasContact, contactError)
  .refine(({ requestType, idea }) => Boolean(requestType) === Boolean(idea), {
    message:
      "Indica el tipo de trabajo y la descripción, o deja ambos pendientes.",
    path: ["idea"],
  });
export const publicLeadSchema = z
  .object({ ...intakeFields, district: text(120).default("") })
  .strict()
  .refine(hasContact, contactError);
export const leadUpdateSchema = z
  .object({
    ...contactFields,
    district: text(120),
    requestType: requestSchema.or(z.literal("")),
    idea: text(4000),
    version: z.number().int().positive(),
    segment: segmentSchema.or(z.literal("")),
    stage: stageSchema,
    assignedTo: text(100),
    contactResult: text(1000),
    appointment: text(40),
    address: text(500),
    workPlan: text(6000),
    contractStatus: z.enum([
      "pending",
      "preparing",
      "sent",
      "signed",
      "not_required",
    ]),
    contractReference: text(500),
    completionNote: text(3000),
    discardReason: text(1000),
  })
  .strict()
  .refine(hasContact, contactError);
export type LeadStage = z.infer<typeof stageSchema>;
export type LeadInput = z.infer<typeof leadUpdateSchema>;
export type LeadEvent = {
  at: string;
  actor: string;
  kind: string;
  text: string;
  from?: LeadStage;
  to?: LeadStage;
};
export type Lead = Omit<LeadInput, "version"> & {
  stageRequest?: import("./works.js").WorkStageRequest;
  workTasks?: import("./works.js").WorkTask[];
  completionReview?: {
    requestedBy: string;
    requestedAt: string;
    note: string;
  } | null;
  workAssignment?: {
    coordinatorId: string;
    participantIds: string[];
    coordinatorName: string;
    participantNames: string[];
  };
  workHandoff?: {
    status: "submitted" | "accepted" | "returned";
    submittedBy: string;
    submittedAt: string;
    decidedBy?: string;
    decidedAt?: string;
    observation: string;
  };
  id: string;
  version: number;
  source: keyof typeof LEAD_SOURCE_LABELS;
  createdAt: string;
  updatedAt: string;
  contactedAt: string | null;
  completedAt: string | null;
  events: LeadEvent[];
};
export const MATERIAL_UNITS = [
  { id: "m2", name: "m²" },
  { id: "m", name: "Metro lineal" },
  { id: "unit", name: "Unidad" },
  { id: "kg", name: "kg" },
  { id: "l", name: "Litro" },
] as const;
export const MATERIAL_CATEGORIES = [
  "Vidrio",
  "Aluminio",
  "Herrajes",
  "Selladores",
  "Aglomerado",
  "Otros",
] as const;
export const quantitySchema = z
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .refine(
    (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001,
    "Usa hasta tres decimales.",
  );
export const materialSchema = z
  .object({
    sku: text(60)
      .min(1)
      .transform((s) => s.toUpperCase()),
    name: text(160).min(2),
    unit: z.enum(["m2", "m", "unit", "kg", "l"]),
    category: z.enum(MATERIAL_CATEGORIES),
    location: text(200),
    description: text(1000),
    minimum: z.number().finite().min(0).max(1_000_000),
  })
  .strict();
export const movementSchema = z
  .object({
    operationId: z.string().uuid(),
    kind: z.enum(["receipt", "consumption", "return"]),
    quantity: quantitySchema,
    leadId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .nullable(),
    reason: text(1000).min(4, "Indica el motivo o detalle del movimiento."),
  })
  .strict();
export type Material = z.infer<typeof materialSchema> & {
  reserved?: number;
  available?: number;
  id: string;
  balance: number;
  version: number;
  updatedAt: string;
  unitCostCents?: number;
};
export type Movement = {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  leadId: string | null;
  kind: "receipt" | "consumption" | "return" | "count" | "dispatch";
  costCents?: number;
  unvaluedQuantity?: number;
  valuedQuantity?: number;
  purchaseId?: string;
  dispatchId?: string;
  counted?: number;
  previousBalance?: number;
  quantity: number;
  reason: string;
  actor: string;
  at: string;
  balanceAfter: number;
};
export const PHOTO_TAGS = [
  "Antes",
  "Avance",
  "Resultado",
  "Detalle",
  "Instalación",
  "Materiales",
] as const;
export const photoMetadataSchema = z
  .object({
    caption: z.string().trim().max(500).default(""),
    tags: z
      .array(z.enum(PHOTO_TAGS))
      .max(6)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
    sharing: z.enum(["internal", "clients"]).default("internal"),
  })
  .strict();
export type PhotoMetadata = z.infer<typeof photoMetadataSchema>;
export type GalleryLeadPhoto = LeadAttachment & {
  source: "lead";
  lead: Pick<
    Lead,
    "id" | "name" | "district" | "requestType" | "segment" | "stage"
  >;
};
export type GalleryPublicationPhoto = {
  source: "publication";
  id: string;
  caption: string;
  alt: string;
  url: string;
  createdAt: string;
  publication: {
    title: string;
    location: string;
    category: ProjectInput["category"];
    status: "published" | "draft";
    cover: boolean;
    href?: string;
  };
};
export const GALLERY_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
export const GALLERY_PHOTO_NAME_MAX = 120;
export type GalleryUploadPhoto = {
  source: "upload";
  id: string;
  name: string;
  category: ProjectInput["category"];
  url: string;
  createdAt: string;
};
export type GalleryPhoto =
  | GalleryLeadPhoto
  | GalleryPublicationPhoto
  | GalleryUploadPhoto;
export type GalleryPage = {
  items: GalleryPhoto[];
  total: number;
  page: number;
  pages: number;
};
export type LeadAttachment = PhotoMetadata & {
  revision: number;
  id: string;
  leadId: string;
  name: string;
  type: "photo" | "contract";
  caption: string;
  url: string;
  createdAt: string;
};
export const crmLeadDefaults = {
  assignedTo: "",
  contactResult: "",
  appointment: "",
  address: "",
  workPlan: "",
  contractStatus: "pending" as const,
  contractReference: "",
  completionNote: "",
  discardReason: "",
};

export function isDemoLead(lead: Pick<Lead, "name" | "email">) {
  return /^\[demo\]/i.test(lead.name) || /\.invalid$/i.test(lead.email ?? "");
}
