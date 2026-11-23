import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  LANDING_PLACEMENT_IDS,
  LANDING_PROJECT_LIMIT,
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
import "./landing-projects.css";

const blocks = [
  { id: "quote", name: "Cotiza tu instalación" },
  { id: "caseStudy", name: "Obra destacada" },
  { id: "company", name: "Nosotros" },
] as const;

const sections = [
  { id: "carousel", name: "Carrusel" },
  { id: "blocks", name: "Bloques de la página" },
  { id: "solutions", name: "Soluciones" },
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
  const addProject = useRef<HTMLButtonElement>(null);
  const submit = useRef<HTMLButtonElement>(null);

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
  const changed =
    !!original &&
    (items.length !== original.items.length ||
      items.some(({ id }, index) => id !== original.items[index].id) ||
      LANDING_PLACEMENT_IDS.some(
        (id) => placements[id] !== initialPlacements[id],
      ));
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

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    setItems(reordered);
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
        <footer className="ve-modal-actions">
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
            ref={submit}
            disabled={!changed || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar portada"}
          </button>
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
        <>
          {selection.placements && (
            <nav
              className="project-tabs landing-projects-tabs"
              aria-label="Secciones de la portada"
            >
              {sections.map(({ id, name }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section === id}
                  onClick={() => setSection(id)}
                >
                  {name}
                </button>
              ))}
            </nav>
          )}
          {section === "carousel" ? (
            <>
              <p className="hint">
                Orden de las tarjetas · {items.length} de{" "}
                {LANDING_PROJECT_LIMIT}
              </p>
              <Select
                label="Agregar proyecto publicado"
                triggerRef={addProject}
                placeholder={
                  items.length >= LANDING_PROJECT_LIMIT
                    ? `Selección completa · ${LANDING_PROJECT_LIMIT} proyectos`
                    : available.length
                      ? "Agregar proyecto publicado"
                      : "No hay más proyectos publicados"
                }
                value=""
                options={available.map(({ id, title }) => ({
                  value: id,
                  label: title,
                }))}
                disabled={
                  saving ||
                  items.length >= LANDING_PROJECT_LIMIT ||
                  !available.length
                }
                onChange={(id) => {
                  const project = available.find((entry) => entry.id === id);
                  if (project)
                    setItems([
                      ...items,
                      { id, title: project.title, published: true },
                    ]);
                }}
              />
              {items.length ? (
                <ol
                  className="landing-projects-list"
                  role="list"
                  aria-label="Orden del carrusel"
                >
                  {items.map(({ id, title, published }, index) => (
                    <li key={id}>
                      <span
                        className="landing-projects-position"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <span className="landing-projects-title">
                        {title}
                        {!published && <small>Retirado de la web</small>}
                      </span>
                      <div className="landing-projects-actions">
                        <button
                          type="button"
                          className="ops-icon-button"
                          aria-label={`Subir ${title}`}
                          aria-disabled={index === 0 || saving}
                          onClick={() => !saving && move(index, -1)}
                        >
                          <ArrowUp size={17} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ops-icon-button"
                          aria-label={`Bajar ${title}`}
                          aria-disabled={index === items.length - 1 || saving}
                          onClick={() => !saving && move(index, 1)}
                        >
                          <ArrowDown size={17} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ops-icon-button"
                          aria-label={`Quitar ${title}`}
                          disabled={saving}
                          onClick={() => {
                            setItems(items.filter((item) => item.id !== id));
                            requestAnimationFrame(() => {
                              const next = addProject.current;
                              (next && !next.disabled
                                ? next
                                : submit.current
                              )?.focus();
                            });
                          }}
                        >
                          <X size={17} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  Con esta selección, la portada queda sin tarjetas de
                  proyectos.
                </p>
              )}
            </>
          ) : (
            <div className="landing-projects-fields">
              {(section === "blocks" ? blocks : SOLUTION_SLOTS).map(
                ({ id, name }) => {
                  const current = original?.placements?.[id];
                  const value = placements[id];
                  const currentMissing =
                    value && !published.some((project) => project.id === value);
                  return (
                    <div className="landing-projects-field" key={id}>
                      <div>
                        <strong>{name}</strong>
                        {current?.project && (
                          <small>
                            {current.project.published
                              ? "En la web"
                              : "Retirado"}{" "}
                            · {current.project.title}
                          </small>
                        )}
                      </div>
                      <Select
                        label={name}
                        value={value === null ? "none" : (value ?? "automatic")}
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
        </>
      )}
    </Modal>
  );
}
