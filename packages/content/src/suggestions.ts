import { z } from "zod";
export const SUGGESTION_COMMENTS_PAGE_SIZE = 30;

export const SUGGESTION_SECTIONS = {
  general: "General",
  leads: "Leads",
  works: "Obras",
  inventory: "Inventario",
  accounting: "Contabilidad",
  projects: "Proyectos",
  gallery: "Galería",
  team: "Equipo y perfil",
} as const;
export const SUGGESTION_STATUSES = {
  open: "Nueva",
  reviewing: "En revisión",
  implemented: "Aplicada",
  closed: "Cerrada",
} as const;
export const suggestionId = z.uuid();
export const suggestionSection = z.enum(
  Object.keys(SUGGESTION_SECTIONS) as [
    keyof typeof SUGGESTION_SECTIONS,
    ...Array<keyof typeof SUGGESTION_SECTIONS>,
  ],
);
export const suggestionStatus = z.enum(
  Object.keys(SUGGESTION_STATUSES) as [
    keyof typeof SUGGESTION_STATUSES,
    ...Array<keyof typeof SUGGESTION_STATUSES>,
  ],
);
const content = z
  .object({
    title: z
      .string()
      .trim()
      .min(4, "Escribe un título de al menos 4 caracteres.")
      .max(120),
    body: z
      .string()
      .trim()
      .min(10, "Cuéntanos un poco más sobre tu idea.")
      .max(3000),
    section: suggestionSection,
  })
  .strict();
export const suggestionCreate = content.extend({ id: suggestionId });
export const suggestionEdit = content.extend({
  version: z.number().int().positive(),
});
export const suggestionStatusChange = z
  .object({ status: suggestionStatus, version: z.number().int().positive() })
  .strict();
export const suggestionCommentCreate = z
  .object({
    id: suggestionId,
    body: z.string().trim().min(2, "Escribe tu comentario.").max(2000),
  })
  .strict();
export type SuggestionContent = z.infer<typeof content>;
export type Suggestion = SuggestionContent & {
  id: string;
  status: keyof typeof SUGGESTION_STATUSES;
  author: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type SuggestionSummary = Suggestion & { commentCount: number };
export type SuggestionComment = {
  id: string;
  suggestionId: string;
  body: string;
  author: Suggestion["author"];
  createdAt: string;
};
export type SuggestionDetail = {
  topic: Suggestion;
  comments: SuggestionComment[];
  hasMoreComments: boolean;
  commentCount: number;
};
