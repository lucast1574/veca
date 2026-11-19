"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@veca/ui/src/Icon";
import type { ProjectPage } from "../lib/api";
import { loadProjects } from "../lib/load-projects";
import { ProjectGrid } from "./ProjectGrid";

export function ProjectCollectionResults({
  initial,
  filters,
}: {
  initial: ProjectPage;
  filters: { category: string; q: string; tag: string };
}) {
  const [items, setItems] = useState(initial.items);
  const [page, setPage] = useState(initial.page);
  const [total, setTotal] = useState(initial.total);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const grid = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current === null) return;
    grid.current
      ?.querySelectorAll<HTMLAnchorElement>(".public-project-photo")
      [focusIndex.current]?.focus();
    focusIndex.current = null;
  }, [items.length]);

  function loadMore() {
    setError(false);
    startTransition(async () => {
      const result = await loadProjects(filters, page + 1).catch(() => null);
      if (!result) {
        setError(true);
        return;
      }
      const ids = new Set(items.map((project) => project.id));
      const additions = result.items.filter((project) => !ids.has(project.id));
      if (additions.length) {
        focusIndex.current = items.length;
        setItems([...items, ...additions]);
      }
      setPage(result.page);
      setTotal(result.total);
    });
  }

  const hasMore = page * initial.pageSize < total;
  return (
    <>
      <div ref={grid} aria-busy={pending}>
        <ProjectGrid items={items} />
      </div>
      <div className="collection-load-more">
        <p role="status">
          {Math.min(items.length, total)} de {total}{" "}
          {total === 1 ? "proyecto" : "proyectos"}
        </p>
        {hasMore && (
          <button type="button" onClick={loadMore} disabled={pending}>
            {pending ? "Cargando proyectos…" : "Cargar más proyectos"}
            {!pending && <Icon name="plus" size={18} />}
          </button>
        )}
        {error && (
          <p role="alert">La carga se interrumpió. Inténtalo de nuevo.</p>
        )}
      </div>
    </>
  );
}
