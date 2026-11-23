import { useId, useState } from "react";
import {
  CATEGORIES,
  LEAD_SEGMENTS,
  LEAD_STAGES,
  PHOTO_TAGS,
  REQUEST_TYPES,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/ui";
import type { GalleryFilters } from "./useGallery";

export function GalleryControls({
  filters,
  canOpenProjects,
  change,
}: {
  filters: GalleryFilters;
  canOpenProjects: boolean;
  change: (key: keyof GalleryFilters, value: string) => void;
}) {
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(false);
  const lead = filters.source === "lead";
  const publication = filters.source === "publication";

  return (
    <section
      className="gallery-tools"
      aria-label="Buscar y filtrar fotografías"
    >
      <label className="gallery-search">
        <Search size={20} />
        <input
          type="search"
          aria-label="Buscar fotografías"
          placeholder="Cliente, proyecto o distrito…"
          value={filters.search}
          maxLength={120}
          onChange={(event) => change("search", event.target.value)}
        />
      </label>
      <div className="gallery-filter-line">
        <div
          className="gallery-usage-tabs"
          role="group"
          aria-label="Origen de las fotografías"
        >
          {[
            ["", "Todas las fotos"],
            ["lead", "Fotos de obra"],
            ["publication", "Fotos del sitio web"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filters.source === value}
              onClick={() => {
                if (filters.source === value) return;
                setAdvanced(false);
                change("source", value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="gallery-sort">
          <Select
            label="Orden de las fotografías"
            value={filters.sort}
            options={[
              { value: "newest", label: "Más recientes" },
              { value: "oldest", label: "Más antiguas" },
            ]}
            onChange={(value) => change("sort", value)}
          />
        </div>
      </div>
      {lead && (
        <div className="gallery-source-filters">
          <div className="gallery-filter-line">
            <div
              className="gallery-usage-tabs"
              role="group"
              aria-label="Uso de las fotografías de leads"
            >
              {[
                ["", "Todos los usos"],
                ["clients", "Para mostrar a clientes"],
                ["internal", "Solo uso interno"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filters.sharing === value}
                  onClick={() => change("sharing", value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              aria-controls={advancedId}
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              <SlidersHorizontal size={16} /> Filtrar por obra
            </Button>
          </div>
          <div
            className="gallery-tag-filter"
            role="group"
            aria-label="Etiquetas de fotografías"
          >
            {["", ...PHOTO_TAGS].map((tag) => (
              <button
                type="button"
                key={tag}
                aria-pressed={filters.tag === tag}
                onClick={() => change("tag", tag)}
              >
                {tag || "Todas las etiquetas"}
              </button>
            ))}
          </div>
          <div id={advancedId} className="gallery-advanced" hidden={!advanced}>
            <Select
              label="Tipo de obra"
              value={filters.requestType}
              options={[
                { value: "", label: "Todos los tipos de obra" },
                ...REQUEST_TYPES.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              onChange={(value) => change("requestType", value)}
            />
            <Select
              label="Etapa de la obra"
              value={filters.stage}
              options={[
                { value: "", label: "Todas las etapas" },
                ...LEAD_STAGES.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              onChange={(value) => change("stage", value)}
            />
            <Select
              label="Grupo comercial"
              value={filters.segment}
              options={[
                { value: "", label: "Todos los grupos" },
                ...LEAD_SEGMENTS.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              onChange={(value) => change("segment", value)}
            />
          </div>
        </div>
      )}
      {publication && (
        <div className="gallery-source-filters gallery-advanced">
          <Select
            label="Categoría de publicaciones"
            value={filters.category}
            options={[
              { value: "", label: "Todas las categorías" },
              ...CATEGORIES.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
            onChange={(value) => change("category", value)}
          />
          {canOpenProjects && (
            <Select
              label="Estado de publicación"
              value={filters.status}
              options={[
                { value: "", label: "Todos los estados" },
                { value: "published", label: "Publicadas" },
                { value: "draft", label: "En borrador" },
              ]}
              onChange={(value) => change("status", value)}
            />
          )}
        </div>
      )}
    </section>
  );
}
