import { z } from "zod";
import type { SocialChannel } from "./crm.js";
import { locationKey, matchPeruLocation } from "./locations.js";
export * from "./locations.js";

export const CATEGORIES = [
  {
    id: "edificios",
    name: "Edificios y fachadas",
    description: "Arquitectura y proyectos inmobiliarios",
  },
  {
    id: "viviendas",
    name: "Casas y departamentos",
    description: "Ventanas y soluciones para el hogar",
  },
  {
    id: "interiores",
    name: "Interiores y mamparas",
    description: "Ambientes conectados por el vidrio",
  },
  {
    id: "comercios",
    name: "Oficinas y comercios",
    description: "Espacios para trabajar y recibir",
  },
  {
    id: "remodelaciones",
    name: "Remodelaciones",
    description: "Una nueva perspectiva para tu espacio",
  },
] as const;
export const TAGS = [
  "Ventanas",
  "Mamparas",
  "Fachadas",
  "Puertas de vidrio",
  "Espejos",
  "Vidrio templado",
  "Vidrio laminado",
  "Aluminio",
  "Luz natural",
  "Divisiones",
  "Reemplazo de vidrio",
] as const;
export const categoryIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];
export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
export const plainText = (node: RichNode): string =>
  node.type === "text"
    ? node.text || ""
    : (node.content || [])
        .map(plainText)
        .join(
          ["doc", "bulletList", "orderedList"].includes(node.type) ? " " : "",
        );
export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
};
const allowedNodes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "horizontalRule",
  "image",
]);
const allowedMarks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);
export function validBody(value: unknown): value is RichNode {
  let count = 0;
  const walk = (n: any, depth: number): boolean => {
    if (
      !n ||
      typeof n !== "object" ||
      depth > 20 ||
      ++count > 3000 ||
      !allowedNodes.has(n.type)
    )
      return false;
    if (
      n.text !== undefined &&
      (typeof n.text !== "string" || n.text.length > 30000)
    )
      return false;
    if (n.type === "image" && (!n.attrs || typeof n.attrs.mediaId !== "string"))
      return false;
    if (
      n.marks &&
      (!Array.isArray(n.marks) ||
        !n.marks.every(
          (m: any) =>
            allowedMarks.has(m.type) &&
            (m.type !== "link" ||
              (typeof m.attrs?.href === "string" &&
                /^https?:\/\//i.test(m.attrs.href))),
        ))
    )
      return false;
    return (
      n.content === undefined ||
      (Array.isArray(n.content) &&
        n.content.every((child: unknown) => walk(child, depth + 1)))
    );
  };
  return walk(value, 0) && (value as RichNode).type === "doc";
}
export const bodySchema = z.custom<RichNode>(
  validBody,
  "El contenido contiene un formato no permitido o es demasiado largo.",
);
export const mediaSchema = z.object({
  id: z.string().min(1).max(100),
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().trim().max(220).default(""),
  caption: z.string().trim().max(400).default(""),
  positionX: z.number().min(0).max(100).default(50),
  positionY: z.number().min(0).max(100).default(50),
});
export const PAGE_LAYOUTS = [
  {
    id: "stacked",
    name: "Imagen arriba",
    description: "Fotos a todo el ancho y texto debajo, sección por sección.",
  },
  {
    id: "alternating-left",
    name: "Primera imagen a la izquierda",
    description: "Fotos y texto alternan de lado en cada sección.",
  },
  {
    id: "alternating-right",
    name: "Primera imagen a la derecha",
    description: "Texto a la izquierda al empezar; después se intercambian.",
  },
] as const;
export const projectSectionSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().max(160).default(""),
    body: bodySchema,
    imageIds: z.array(z.string().min(1).max(100)).max(24),
  })
  .strict();
export type ProjectSection = z.infer<typeof projectSectionSchema>;
export type PageLayout = "legacy" | (typeof PAGE_LAYOUTS)[number]["id"];
export const projectText = (project: {
  body: RichNode;
  pageLayout?: PageLayout;
  sections?: ProjectSection[];
}): string =>
  project.pageLayout && project.pageLayout !== "legacy"
    ? (project.sections || [])
        .map((section) => [section.title, plainText(section.body)].join(" "))
        .join(" ")
    : plainText(project.body);

export const projectInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(4, "El título debe tener al menos 4 caracteres.")
      .max(140),
    excerpt: z.string().trim().max(320).default(""),
    category: z.enum(categoryIds),
    tags: z.array(z.enum(TAGS)).max(8),
    location: z.string().trim().max(100).default("Lima"),
    body: bodySchema,
    images: z.array(mediaSchema).max(24),
    coverId: z.string().max(100).nullable(),
    coverLayout: z.enum(["top", "left", "right"]).default("top"),
    pageLayout: z
      .enum(["legacy", "stacked", "alternating-left", "alternating-right"])
      .default("legacy"),
    sections: z.array(projectSectionSchema).max(24).default([]),
    solutionSlot: z
      .enum(["viviendas", "edificios", "interiores", "remodelaciones"])
      .nullable()
      .default(null),
    featured: z.boolean().default(false),
    featuredOrder: z.number().int().min(0).max(999).default(0),
    version: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type Project = ProjectInput & {
  id: string;
  slug: string;
  status: "draft" | "published";
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  seo: {
    title: string;
    description: string;
    canonical: string;
    image: string | null;
  };
  hasUnpublishedChanges?: boolean;
  hasBeenPublished?: boolean;
  socialShareQueuedAt?: string;
  socialDelivery?: Record<
    SocialChannel,
    "pending" | "processing" | "published" | "review" | "retry"
  >;
};
export type PublicationRequirement = {
  message: string;
  target: string;
  photoId?: string;
  sectionId?: string;
};
export function publicationRequirements(
  project: ProjectInput,
): PublicationRequirement[] {
  const requirements: PublicationRequirement[] = [];
  const cover = project.images.find((image) => image.id === project.coverId);
  const firstUndescribed = project.images.find(
    (image) => !image.alt.trim() && image.id !== cover?.id,
  );
  const firstSection = project.sections[0]?.id;
  const emptySection = project.sections.find(
    (section) =>
      !section.imageIds.length &&
      !plainText(section.body).trim() &&
      !section.title.trim(),
  );
  if (project.title.trim().length < 4)
    requirements.push({
      message: "Escribe un título de al menos 4 caracteres.",
      target: "title",
    });
  if (!project.location?.trim())
    requirements.push({
      message: "Selecciona la ubicación del proyecto.",
      target: "location-region",
    });
  if (!cover || !cover.alt.trim())
    requirements.push({
      message: "Selecciona una portada y escribe su descripción.",
      target: cover
        ? "image-alt"
        : project.images.length
          ? "choose-cover"
          : "add-project-photos",
      photoId: cover?.id || project.images[0]?.id,
    });
  if (projectText(project).trim().length < 60)
    requirements.push({
      message:
        "Describe el proyecto con al menos 60 caracteres antes de publicarlo.",
      target: "project-story",
      sectionId: firstSection,
    });
  if (firstUndescribed)
    requirements.push({
      message: "Describe las fotos que faltan para que sean accesibles.",
      target: "image-alt",
      photoId: firstUndescribed.id,
    });
  if (project.pageLayout !== "legacy" && emptySection)
    requirements.push({
      message: "Completa o quita las secciones vacías antes de publicar.",
      target: `section-${emptySection.id}`,
      sectionId: emptySection.id,
    });
  if (
    project.pageLayout !== "legacy" &&
    !project.sections.some((section) => section.imageIds.length)
  )
    requirements.push({
      message: "Elige al menos una foto para las secciones de la página.",
      target: !project.images.length
        ? "add-project-photos"
        : "story-photo-options",
      sectionId: firstSection,
    });
  return requirements;
}
export function publicationIssues(project: ProjectInput): string[] {
  return publicationRequirements(project).map(({ message }) => message);
}

export function seoFor(project: ProjectInput, slug: string) {
  const name = project.title.trim() || "Proyecto";
  const location = project.location?.trim() || "";
  const place = matchPeruLocation(location);
  const locality = place?.locality;
  const nameKey = ` ${locationKey(name)} `;
  const withLocation = locality ? `${name} en ${locality}` : name;
  const title =
    locality &&
    !nameKey.includes(` ${locationKey(locality)} `) &&
    withLocation.length + " | Vidrios VECA".length <= 72
      ? withLocation
      : name;
  const sectionText =
    project.pageLayout && project.pageLayout !== "legacy"
      ? (project.sections || [])
          .map(({ body }) => plainText(body).trim())
          .filter(Boolean)
          .join(" ")
      : plainText(project.body);
  const text = (
    project.excerpt?.trim() ||
    sectionText.trim() ||
    (project.title.trim()
      ? `${name}. Proyecto de Vidrios VECA${location ? ` en ${location}` : ""}.`
      : "")
  )
    .replace(/\s+/g, " ")
    .trim();
  const snippet =
    text.length <= 160
      ? text
      : text
          .slice(0, 159)
          .replace(/\s+\S*$/, "")
          .replace(/[\s,;:]+$/, "") + "…";
  return {
    title: `${title} | Vidrios VECA`,
    description: snippet,
    canonical: `https://veca.com.pe/proyectos/${slug}/`,
    image: project.images.find((i) => i.id === project.coverId)?.url || null,
  };
}
export const emptyProject = (): ProjectInput => ({
  title: "",
  excerpt: "",
  category: "viviendas",
  tags: [],
  location: "Lima",
  body: { type: "doc", content: [{ type: "paragraph" }] },
  images: [],
  coverId: null,
  coverLayout: "top",
  pageLayout: "legacy",
  sections: [],
  solutionSlot: null,
  featured: false,
  featuredOrder: 0,
});

export * from "./crm.js";
export * from "./works.js";

export * from "./access.js";
export * from "./administration.js";
export * from "./dispatch.js";
export * from "./demo.js";
export * from "./accounting.js";

export * from "./warehouse.js";
export * from "./supply-requests.js";

export * from "./landing-projects.js";

export * from "./labor.js";

export * from "./work-control.js";
