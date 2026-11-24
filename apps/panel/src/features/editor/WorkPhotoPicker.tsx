import { useRef, useState } from "react";
import { ArrowRight, Check, Images, MapPin } from "lucide-react";
import type { Project, WorkProjectSource } from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api, ApiError, API_BASE } from "../../lib/api";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import "./work-publication.css";

export function WorkPhotoPicker({
  id,
  onClose,
  onCreated,
}: {
  id: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const query = useAccountingQuery<WorkProjectSource>(
    `/admin/project-sources/works/${id}`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operationId = useRef(crypto.randomUUID());
  const clearGuard = useUnsavedChanges(selected.length > 0, busy);
  const close = () => {
    if (confirmDiscard(selected.length > 0, busy)) onClose();
  };
  async function create() {
    if (!query.data || !selected.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const project = await api<Project>(
        `/admin/project-sources/works/${id}/draft`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            operationId: operationId.current,
            version: query.data.work.version,
            photoIds: selected,
          }),
        },
      );
      clearGuard();
      onCreated(project);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        query.refresh();
        setError(
          "La obra cambió. Actualizamos la información; revisa tu selección y vuelve a continuar.",
        );
      } else
        setError(
          error instanceof DOMException
            ? "La preparación tardó más de lo esperado. Puedes reintentar con las mismas fotos sin duplicar el borrador."
            : (error as Error).message,
        );
      setBusy(false);
    }
  }
  return (
    <Modal
      title="De la obra al proyecto"
      description="Elige las fotos que quieres contar. Después podrás editar el nombre, escribir la historia y añadir más fotos."
      size="wide"
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions work-photo-footer">
          <span role="status">{selected.length} de 24 fotos elegidas</span>
          <div>
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button
              disabled={
                busy || !selected.length || !query.data || query.loading
              }
              onClick={() => void create()}
            >
              {busy ? "Preparando borrador…" : "Continuar en Proyectos"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </footer>
      }
    >
      <QueryState {...query}>
        {query.data && (
          <>
            <div className="work-source-summary">
              <div>
                <span>OBRA REALIZADA</span>
                <h3>{query.data.work.name}</h3>
                <p>
                  <MapPin size={15} />
                  {query.data.work.location || "Ubicación por completar"}
                </p>
              </div>
              <p>{query.data.work.result || query.data.work.plan}</p>
            </div>
            <p className="hint">
              Las fotos elegidas se reutilizan en un borrador privado. Solo se
              mostrarán en la web cuando publiques el proyecto.
            </p>
            {!query.data.photos.length && (
              <div className="work-photo-empty">
                <Images size={28} />
                <p>
                  Esta obra aún no tiene fotos. Puedes añadirlas en Archivos y
                  volver a elegirlas aquí, o crear un proyecto y subirlas
                  manualmente.
                </p>
              </div>
            )}
            <div className="work-photo-grid">
              {query.data.photos.map((photo, index) => (
                <button
                  key={photo.id}
                  className="work-photo-tile"
                  type="button"
                  disabled={
                    busy ||
                    (selected.length >= 24 && !selected.includes(photo.id))
                  }
                  aria-label={`Elegir foto ${index + 1}${photo.caption ? ": " + photo.caption : ""}`}
                  aria-pressed={selected.includes(photo.id)}
                  onClick={() =>
                    setSelected((old) =>
                      old.includes(photo.id)
                        ? old.filter((value) => value !== photo.id)
                        : old.length < 24
                          ? [...old, photo.id]
                          : old,
                    )
                  }
                >
                  <img
                    src={API_BASE + photo.url}
                    alt={photo.caption || `Foto ${index + 1} de la obra`}
                    loading="lazy"
                  />
                  <span className="work-photo-selection">
                    {selected.includes(photo.id) ? (
                      <Check size={16} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <strong>
                      {photo.caption || `Fotografía ${index + 1}`}
                    </strong>
                    {photo.tags.length > 0 && (
                      <small>{photo.tags.join(" · ")}</small>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </QueryState>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
