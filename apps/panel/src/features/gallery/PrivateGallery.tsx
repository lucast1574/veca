import { useCallback, useState } from "react";
import {
  CATEGORIES,
  LEAD_SEGMENTS,
  LEAD_STAGES,
  REQUEST_TYPES,
  type GalleryPhoto,
} from "@veca/content";
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
  const { source, sort, search } = filters;
  const criteria = {
    ...emptyGalleryFilters,
    source,
    sort,
    search,
    ...(source === "lead"
      ? {
          sharing: filters.sharing,
          tag: filters.tag,
          stage: filters.stage,
          segment: filters.segment,
          requestType: filters.requestType,
        }
      : {}),
    ...(source === "publication"
      ? { status: filters.status, category: filters.category }
      : {}),
  };
  const { data, current, loading, error, refresh } = useGallery(criteria, page);
  const close = useCallback(() => setSelected(null), []);
  function change(key: keyof GalleryFilters, value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(1);
  }
  const stage = LEAD_STAGES.find((item) => item.id === criteria.stage)?.name;
  const segment = LEAD_SEGMENTS.find(
    (item) => item.id === criteria.segment,
  )?.name;
  const type = REQUEST_TYPES.find(
    (item) => item.id === criteria.requestType,
  )?.name;
  const category = CATEGORIES.find(
    (item) => item.id === criteria.category,
  )?.name;
  const activeFilters = [
    ["stage", stage],
    ["segment", segment],
    ["requestType", type],
    ["category", category],
    [
      "sharing",
      criteria.sharing === "clients"
        ? "Para mostrar a clientes"
        : criteria.sharing
          ? "Solo uso interno"
          : "",
    ],
    ["tag", criteria.tag],
    [
      "status",
      criteria.status === "published"
        ? "En la web"
        : criteria.status
          ? "En borrador"
          : "",
    ],
  ] as const;
  const hasCriteria = Boolean(
    criteria.search.trim() || activeFilters.some(([, label]) => label),
  );
  const filtered = hasCriteria || Boolean(source);
  return (
    <main className="ops-page private-gallery">
      <header className="gallery-heading">
        <h1>
          Galería<span>.</span>
        </h1>
        <p>
          Encuentra fotos de obra y del sitio web. Cada foto indica cómo puedes
          usarla.
        </p>
      </header>
      <GalleryControls
        filters={filters}
        change={change}
        canOpenProjects={canOpenProjects}
      />
      {activeFilters.some(([, label]) => label) && (
        <div
          className="gallery-usage-tabs"
          role="group"
          aria-label="Filtros activos"
        >
          {activeFilters.map(
            ([key, label]) =>
              label && (
                <button
                  type="button"
                  key={key}
                  onClick={() => change(key, "")}
                  aria-label={`Quitar filtro ${label}`}
                >
                  {label} <span aria-hidden="true">×</span>
                </button>
              ),
          )}
        </div>
      )}
      <div className="gallery-result-line">
        <p aria-live="polite">
          {loading
            ? data?.items.length
              ? "Actualizando fotografías…"
              : "Buscando fotografías…"
            : !current && data?.items.length
              ? "Mostrando la búsqueda anterior"
              : current && data
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
      {loading && !data?.items.length ? (
        <div className="gallery-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="gallery-skeleton" key={i} />
          ))}
        </div>
      ) : !!data?.items.length ? (
        <div className="gallery-grid" aria-busy={loading}>
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
      {current && !!data && data.pages > 1 && (
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
