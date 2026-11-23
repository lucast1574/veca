import { useState } from "react";
import { ArrowUpRight, LayoutGrid, PanelsTopLeft, Shapes } from "lucide-react";
import {
  LANDING_PLACEMENT_IDS,
  SOLUTION_SLOTS,
  type LandingPlacementId,
  type LandingPlacements,
  type LandingProjectSelection,
  type Project,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { LandingCarouselEditor } from "./LandingCarouselEditor";
import "./landing-projects.css";

import { landingBlocks as blocks } from "./PublicationPlacement";

const sections = [
  {
    id: "carousel",
    name: "Carrusel",
    Icon: LayoutGrid,
    detail: "Selección y orden de las tarjetas.",
  },
  {
    id: "blocks",
    name: "Bloques de la página",
    Icon: PanelsTopLeft,
    detail: "Cotización, Obra destacada y Nosotros.",
  },
  {
    id: "solutions",
    name: "Soluciones",
    Icon: Shapes,
    detail: "Un proyecto de ejemplo por solución.",
  },
] as const;

export function LandingProjects({
  projects,
  selection,
  loadError,
  onReload,
  onClose,
  onSelection,
}: {
  projects: Project[];
  selection?: LandingProjectSelection;
  loadError: string;
  onReload: () => void;
  onClose: () => void;
  onSelection: (selection: LandingProjectSelection) => void;
}) {
  const [draft, setDraft] = useState<{
    original: LandingProjectSelection;
    items: LandingProjectSelection["items"];
    placements: LandingPlacements<string | null>;
  }>();
  const [section, setSection] =
    useState<(typeof sections)[number]["id"]>("carousel");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const original = draft?.original ?? selection;
  const items = draft?.items ?? original?.items ?? [];
  const initialPlacements: LandingPlacements<string | null> = {};
  for (const id of LANDING_PLACEMENT_IDS) {
    const placement = original?.placements?.[id];
    if (placement && !placement.automatic)
      initialPlacements[id] = placement.project?.id ?? null;
  }
  const placements = draft?.placements ?? initialPlacements;
  const published = projects.filter(
    (project) => project.status === "published",
  );
  const selected = new Set(items.map(({ id }) => id));
  const available = published.filter(({ id }) => !selected.has(id));
  const carouselChanged =
    items.length !== original?.items.length ||
    items.some(({ id }, index) => id !== original?.items[index]?.id);
  const placementChanged = (id: LandingPlacementId) =>
    placements[id] !== initialPlacements[id];
  const sectionChanges = {
    carousel: original && carouselChanged ? 1 : 0,
    blocks: blocks.filter(({ id }) => placementChanged(id)).length,
    solutions: LANDING_PLACEMENT_IDS.filter(
      (id) => !blocks.some((block) => block.id === id) && placementChanged(id),
    ).length,
  };
  const changeCount = Object.values(sectionChanges).reduce(
    (sum, value) => sum + value,
    0,
  );
  const changed = changeCount > 0;
  const activeSection = sections.find(({ id }) => id === section)!;
  useUnsavedChanges(changed, saving);

  function setItems(items: LandingProjectSelection["items"]) {
    if (original) setDraft({ original, items, placements });
  }

  function changePlacement(id: LandingPlacementId, value: string) {
    if (!original) return;
    const next = { ...placements };
    if (value === "automatic") delete next[id];
    else next[id] = value === "none" ? null : value;
    setDraft({ original, items, placements: next });
  }

  async function save() {
    if (!original || !changed || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<LandingProjectSelection>(
        "/admin/projects/landing",
        {
          method: "PUT",
          body: JSON.stringify({
            revision: original.revision,
            projectIds: items.map(({ id }) => id),
            ...(original.placements && { placements }),
          }),
        },
      );
      onSelection(result);
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 409) onReload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Proyectos en la portada"
      description="Elige los proyectos publicados que aparecen en cada sección de la web."
      onClose={() => {
        if (confirmDiscard(changed, saving)) onClose();
      }}
      busy={saving}
      className="landing-projects-modal"
      size="wide"
      footer={
        <footer className="ve-modal-actions landing-projects-footer">
          <span role="status" className="landing-draft-status">
            {changeCount
              ? `${changeCount} ${changeCount === 1 ? "cambio pendiente" : "cambios pendientes"}`
              : selection
                ? "Portada al día"
                : ""}
          </span>
          <div className="landing-footer-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={onClose}
            >
              {changed ? "Descartar cambios" : "Cerrar"}
            </Button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!changed || saving}
              onClick={() => void save()}
            >
              {saving ? "Guardando…" : "Guardar portada"}
            </button>
          </div>
        </footer>
      }
    >
      {error && <Notice error>{error}</Notice>}
      {!selection ? (
        loadError ? (
          <Notice error>{loadError}</Notice>
        ) : (
          <p role="status">Cargando la selección actual…</p>
        )
      ) : (
        <div className="landing-projects-layout">
          <nav
            className="landing-section-nav"
            aria-label="Secciones de la portada"
          >
            {(selection.placements ? sections : sections.slice(0, 1)).map(
              ({ id, name, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section === id}
                  onClick={() => setSection(id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{name}</span>
                  {sectionChanges[id] > 0 && (
                    <small
                      aria-label={`${sectionChanges[id]} cambios pendientes`}
                    >
                      {sectionChanges[id]}
                    </small>
                  )}
                </button>
              ),
            )}
            <a
              href="https://veca.com.pe/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver portada publicada{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </nav>
          <section
            className="landing-active-section"
            aria-label={activeSection.name}
          >
            <header>
              <h3>{activeSection.name}</h3>
              <p>{activeSection.detail}</p>
            </header>
            {section === "carousel" ? (
              <LandingCarouselEditor
                items={items}
                available={available}
                saving={saving}
                onChange={setItems}
              />
            ) : (
              <div className="landing-projects-fields">
                {(section === "blocks" ? blocks : SOLUTION_SLOTS).map(
                  ({ id, name }) => {
                    const current = original?.placements?.[id];
                    const value = placements[id];
                    const currentMissing =
                      value &&
                      !published.some((project) => project.id === value);
                    return (
                      <div className="landing-projects-field" key={id}>
                        <div>
                          <strong>{name}</strong>
                          {current?.project ? (
                            <small>
                              {current.project.published
                                ? "En la web"
                                : "Retirado"}{" "}
                              · {current.project.title}
                            </small>
                          ) : (
                            <small>Sin proyecto publicado</small>
                          )}
                          {placementChanged(id) && (
                            <small className="landing-pending-label">
                              Cambio pendiente
                            </small>
                          )}
                        </div>
                        <Select
                          label={name}
                          value={
                            value === null ? "none" : (value ?? "automatic")
                          }
                          options={[
                            {
                              value: "automatic",
                              label:
                                section === "solutions"
                                  ? "Según el editor de proyectos"
                                  : "Proyecto original",
                            },
                            { value: "none", label: "Sin proyecto" },
                            ...(currentMissing
                              ? [
                                  {
                                    value,
                                    label:
                                      current?.project?.title ??
                                      "Proyecto retirado",
                                  },
                                ]
                              : []),
                            ...published.map(({ id, title }) => ({
                              value: id,
                              label: title,
                            })),
                          ]}
                          disabled={saving}
                          onChange={(value) => changePlacement(id, value)}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
