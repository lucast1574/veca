import { useCallback, useState } from "react";
import { type GalleryPhoto } from "@veca/content";
import { Images, ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { Button, Notice } from "../../components/ui";
import { GalleryControls } from "./GalleryControls";
import { GalleryPhotoCard } from "./GalleryPhotoCard";
import { GalleryViewer } from "./GalleryViewer";
import {
  emptyGalleryFilters,
  useGallery,
  type GalleryFilters,
} from "./useGallery";
import "./gallery.css";
export function PrivateGallery({
  canOpenLead,
  canOpenProjects,
}: {
  canOpenLead: boolean;
  canOpenProjects: boolean;
}) {
  const [filters, setFilters] = useState(emptyGalleryFilters),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<GalleryPhoto | null>(null);
  const { data, loading, error, refresh } = useGallery(filters, page);
  const close = useCallback(() => setSelected(null), []);
  const change = (key: keyof GalleryFilters, value: string) => {
    setFilters((old) =>
      key === "source"
        ? {
            ...emptyGalleryFilters,
            search: old.search,
            sort: old.sort,
            source: value,
          }
        : { ...old, [key]: value },
    );
    setPage(1);
  };
  const { source, sort, ...criteria } = filters;
  const hasCriteria = Object.values(criteria).some((value) => value.trim());
  const filtered = hasCriteria || Boolean(source);
  return (
    <main className="ops-page private-gallery">
      <header className="gallery-heading">
        <h1>
          Galería<span>.</span>
        </h1>
        <p>Fotografías de leads y publicaciones del equipo.</p>
      </header>
      <GalleryControls
        filters={filters}
        change={change}
        canOpenProjects={canOpenProjects}
      />
      <div className="gallery-result-line">
        <p aria-live="polite">
          {loading
            ? "Buscando fotografías…"
            : data
              ? `${data.total} ${data.total === 1 ? "fotografía" : "fotografías"}${filtered ? " en esta selección" : " en la galería"}`
              : "No se pudo cargar la galería"}
        </p>
        <div className="gallery-result-actions">
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="Actualizar galería"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
          {(filtered || sort !== emptyGalleryFilters.sort) && (
            <button
              onClick={() => {
                setFilters(emptyGalleryFilters);
                setPage(1);
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>
      {error && (
        <Notice error>
          {error} <button onClick={refresh}>Reintentar</button>
        </Notice>
      )}
      {loading ? (
        <div className="gallery-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="gallery-skeleton" key={i} />
          ))}
        </div>
      ) : !!data?.items.length ? (
        <div className="gallery-grid">
          {data.items.map((photo) => (
            <GalleryPhotoCard
              key={photo.id}
              photo={photo}
              onOpen={() => setSelected(photo)}
            />
          ))}
        </div>
      ) : (
        !error && (
          <section className="gallery-empty">
            <Images size={38} />
            <h2>
              {hasCriteria
                ? "No encontramos fotografías"
                : "Aún no hay fotografías"}
            </h2>
            <p>
              {hasCriteria
                ? "Prueba otra búsqueda o limpia los filtros."
                : source === "lead"
                  ? "Las fotos aparecerán aquí al adjuntarlas a un lead."
                  : source === "publication"
                    ? "Las imágenes de los proyectos aparecerán aquí al guardarlas."
                    : "Añade fotos a un lead o guarda imágenes en una publicación para verlas aquí."}
            </p>
            <div className="gallery-empty-actions">
              {canOpenLead && filters.source !== "publication" && (
                <a href="#leads" className="btn btn-primary">
                  Ir a los leads
                </a>
              )}
              {canOpenProjects && filters.source !== "lead" && (
                <a href="#projects" className="btn btn-ghost">
                  Ir a Publicaciones
                </a>
              )}
            </div>
          </section>
        )
      )}
      {!!data && data.pages > 1 && (
        <nav className="gallery-pagination" aria-label="Páginas de fotografías">
          <Button
            variant="ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage((v) => v - 1)}
          >
            <ArrowLeft size={16} /> Anterior
          </Button>
          <span>
            {page} de {data.pages}
          </span>
          <Button
            variant="ghost"
            disabled={page >= data.pages || loading}
            onClick={() => setPage((v) => v + 1)}
          >
            Siguiente <ArrowRight size={16} />
          </Button>
        </nav>
      )}
      {selected && (
        <GalleryViewer
          key={selected.id}
          initial={selected}
          photos={data?.items || [selected]}
          canOpenLead={canOpenLead}
          canOpenProjects={canOpenProjects}
          onClose={close}
          onSaved={refresh}
        />
      )}
    </main>
  );
}
