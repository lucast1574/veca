export type ProjectSearch = { q?: string; tag?: string; page?: string };

export function collectionHref(path: string, values: ProjectSearch) {
  const query = new URLSearchParams();
  if (typeof values.q === "string" && values.q) query.set("q", values.q);
  if (typeof values.tag === "string" && values.tag)
    query.set("tag", values.tag);
  return path + (query.size ? "?" + query.toString() : "");
}
