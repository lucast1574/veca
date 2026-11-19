"use server";

import { CATEGORIES, TAGS } from "@veca/content";
import { projects } from "./api";

export async function loadProjects(
  filters: { category: string; q: string; tag: string },
  page: number,
) {
  if (!Number.isInteger(page) || page < 2 || page > 10000) return null;
  const { category, q, tag } = filters;
  if (
    typeof q !== "string" ||
    (category !== "" && !CATEGORIES.some((entry) => entry.id === category)) ||
    (tag !== "" && !TAGS.some((entry) => entry === tag))
  )
    return null;

  return projects({
    category,
    q: q.slice(0, 120),
    tag,
    page: String(page),
  }).catch(() => null);
}
