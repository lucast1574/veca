import { useState } from "react";
import { ArrowRight, HardHat } from "lucide-react";
import type { CompletedWorkSource } from "@veca/content";
import { Button } from "../../components/ui";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import "./work-publication.css";
export function CompletedWorks() {
  const [page, setPage] = useState(1);
  const query = useAccountingQuery<{
    items: CompletedWorkSource[];
    total: number;
    pages: number;
  }>(`/admin/project-sources/works?page=${page}`);
  if (query.data?.total === 0) return null;
  return (
    <section className="completed-work-section">
      <header>
        <div>
          <p className="overline">DEL TRABAJO A LA HISTORIA</p>
          <h2>Obras realizadas</h2>
          <p>Reutiliza sus fotos y prepara el próximo proyecto.</p>
        </div>
        <HardHat size={24} aria-hidden="true" />
      </header>
      <QueryState {...query}>
        <div className="completed-work-grid">
          {query.data?.items.map((work) => (
            <article key={work.id}>
              <span>{work.location}</span>
              <h3>{work.name}</h3>
              <p>
                {work.project
                  ? work.project.status === "published"
                    ? "Ya tiene un proyecto publicado"
                    : "Tiene un borrador preparado"
                  : "Lista para preparar su historia"}
              </p>
              <a
                className="warehouse-link"
                href={
                  work.project
                    ? `#projects/${work.project.id}`
                    : `#projects/from-work/${work.id}`
                }
              >
                {work.project ? "Abrir proyecto" : "Elegir fotos"}
                <ArrowRight size={16} />
              </a>
            </article>
          ))}
        </div>
        {query.data && query.data.pages > 1 && (
          <nav
            aria-label="Páginas de obras realizadas"
            className="gallery-pagination"
          >
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>
              {page} / {query.data.pages}
            </span>
            <Button
              variant="ghost"
              disabled={page === query.data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </nav>
        )}
      </QueryState>
    </section>
  );
}
