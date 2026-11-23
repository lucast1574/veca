import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  LANDING_PROJECT_LIMIT,
  type LandingProjectSelection,
  type Project,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import "./landing-projects.css";

export function LandingProjects({
  projects,
  onClose,
  onSelection,
}: {
  projects: Project[];
  onClose: () => void;
  onSelection: (selection: LandingProjectSelection) => void;
}) {
  const [selection, setSelection] = useState<LandingProjectSelection>();
  const [items, setItems] = useState<LandingProjectSelection["items"]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const addProject = useRef<HTMLButtonElement>(null);
  const submit = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<LandingProjectSelection>("/admin/projects/landing", {
      signal: controller.signal,
    })
      .then((value) => {
        setSelection(value);
        setItems(value.items);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [attempt]);

  const selected = new Set(items.map(({ id }) => id));
  const available = projects.filter(
    ({ id, status }) => status === "published" && !selected.has(id),
  );
  const changed =
    !!selection &&
    (items.length !== selection.items.length ||
      items.some(({ id }, index) => id !== selection.items[index].id));
  useUnsavedChanges(changed, saving);

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
    if (!selection || !changed || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<LandingProjectSelection>(
        "/admin/projects/landing",
        {
          method: "PUT",
          body: JSON.stringify({
            revision: selection.revision,
            projectIds: items.map(({ id }) => id),
          }),
        },
      );
      onSelection(result);
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Proyectos en la portada"
      description={`Elige hasta ${LANDING_PROJECT_LIMIT} proyectos publicados y ordénalos como aparecerán en el carrusel de la web.`}
      onClose={() => {
        if (confirmDiscard(changed, saving)) onClose();
      }}
      busy={saving}
      className="landing-projects-modal"
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
        error ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError("");
              setAttempt((previous) => previous + 1);
            }}
          >
            Reintentar
          </Button>
        ) : (
          <p role="status">Cargando la selección actual…</p>
        )
      ) : (
        <>
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
              Con esta selección, la portada queda sin tarjetas de proyectos.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
