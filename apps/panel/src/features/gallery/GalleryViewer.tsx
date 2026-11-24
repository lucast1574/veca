import { useCallback, useRef, useState } from "react";
import { CATEGORIES } from "@veca/content";
import type {
  GalleryLeadPhoto,
  GalleryPhoto,
  PhotoMetadata,
} from "@veca/content";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Pencil,
  Presentation,
  ShieldCheck,
  LockKeyhole,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { galleryPhotoUrl } from "./GalleryPhotoCard";
import { PhotoMetadataFields } from "./PhotoMetadataFields";
export function GalleryViewer({
  initial,
  photos,
  canOpenLead,
  canOpenProjects,
  onClose,
  onSaved,
}: {
  initial: GalleryPhoto;
  photos: GalleryPhoto[];
  canOpenLead: boolean;
  canOpenProjects: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selection, setSelection] = useState(photos);
  const [photo, setPhoto] = useState(initial),
    [editing, setEditing] = useState(false),
    [presenting, setPresenting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<PhotoMetadata>({
    caption: initial.source === "lead" ? initial.caption : "",
    tags: initial.source === "lead" ? initial.tags : [],
    sharing: initial.source === "lead" ? initial.sharing : "internal",
  });
  const latest = useRef({ dirty: false, busy: false });
  latest.current = {
    dirty:
      editing &&
      photo.source === "lead" &&
      JSON.stringify(draft) !==
        JSON.stringify({
          caption: photo.caption,
          tags: photo.tags,
          sharing: photo.sharing,
        }),
    busy,
  };
  const close = useCallback(() => {
    if (
      !latest.current.busy &&
      (!latest.current.dirty ||
        confirm("¿Cerrar sin guardar los cambios de esta foto?"))
    )
      onClose();
  }, [onClose]);
  const candidates = presenting
    ? selection.filter((p) => p.source === "lead" && p.sharing === "clients")
    : selection;
  const index = candidates.findIndex((p) => p.id === photo.id);
  function move(delta: number) {
    const next = candidates[index + delta];
    if (next) {
      setPhoto(next);
      setError("");
    }
  }
  async function save() {
    if (photo.source !== "lead") return;
    setBusy(true);
    setError("");
    try {
      const result = await api<GalleryLeadPhoto>(
        `/admin/gallery/photos/${photo.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ ...draft, revision: photo.revision }),
        },
      );
      const updated = { ...photo, ...result, url: photo.url };
      setPhoto(updated);
      setSelection((old) =>
        old.map((p) => (p.id === updated.id ? updated : p)),
      );
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const publication = photo.source === "publication" ? photo.publication : null;
  const title =
    photo.source === "upload"
      ? photo.name
      : photo.caption ||
        (photo.source === "publication"
          ? photo.alt || photo.publication.title
          : "Fotografía de obra");
  const uploadCategory =
    photo.source === "upload"
      ? CATEGORIES.find(({ id }) => id === photo.category)?.name
      : undefined;
  return (
    <Modal
      size="wide"
      title={presenting ? "Una nueva perspectiva para tu espacio" : title}
      description={
        presenting
          ? "Vidrios VECA"
          : publication
            ? publication.status === "published"
              ? "Publicación web"
              : "Borrador de publicación"
            : photo.source === "upload"
              ? [uploadCategory, "Uso interno"].filter(Boolean).join(" · ")
              : "Fotografía del lead · Galería del equipo"
      }
      onClose={close}
      busy={busy}
    >
      <div
        className="gallery-viewer"
        onKeyDown={(e) => {
          if (
            editing ||
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target as HTMLElement).closest('[role="combobox"]')
          )
            return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            move(e.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <div className="gallery-viewer-photo">
          <img
            src={galleryPhotoUrl(photo.url)}
            alt={photo.source === "publication" ? photo.alt || title : title}
          />
        </div>
        {!editing && (
          <div className="gallery-viewer-navigation">
            <Button
              variant="ghost"
              disabled={index <= 0}
              onClick={() => move(-1)}
              aria-label="Foto anterior"
            >
              <ArrowLeft size={18} />
            </Button>
            <span>
              {index + 1} / {candidates.length} en esta selección
            </span>
            <Button
              variant="ghost"
              disabled={index < 0 || index >= candidates.length - 1}
              onClick={() => move(1)}
              aria-label="Foto siguiente"
            >
              <ArrowRight size={18} />
            </Button>
          </div>
        )}
        {presenting ? (
          <div className="gallery-presentation-caption">
            <p>{photo.source === "lead" ? photo.caption : ""}</p>
            <Button variant="ghost" onClick={() => setPresenting(false)}>
              Volver a la galería privada
            </Button>
          </div>
        ) : publication ? (
          <>
            <div className="gallery-detail-summary">
              <strong>{publication.title}</strong>
              <span>
                {[publication.location, publication.cover ? "Portada" : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {(publication.href || canOpenProjects) && (
              <div className="gallery-viewer-actions">
                {publication.href ? (
                  <a href={publication.href} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} /> Ver publicación en la web
                  </a>
                ) : (
                  <a href="#projects" onClick={close}>
                    <ExternalLink size={15} /> Ir a Publicaciones
                  </a>
                )}
              </div>
            )}
          </>
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy} className="gallery-edit-fields">
              <PhotoMetadataFields value={draft} onChange={setDraft} />
            </fieldset>
            {error && <Notice error>{error}</Notice>}
            <div className="gallery-viewer-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Guardando…" : "Guardar foto"}
              </Button>
            </div>
          </form>
        ) : (
          photo.source === "lead" && (
            <>
              <div className="gallery-detail-summary">
                <span className={`photo-use photo-use-${photo.sharing}`}>
                  {photo.sharing === "clients" ? (
                    <ShieldCheck size={15} />
                  ) : (
                    <LockKeyhole size={15} />
                  )}{" "}
                  {photo.sharing === "clients"
                    ? "Autorizada para mostrar a clientes"
                    : "Solo uso interno"}
                </span>
                <span>
                  {photo.lead.name} · {photo.lead.district}
                </span>
              </div>
              <div className="gallery-photo-tags">
                {photo.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="gallery-viewer-actions">
                {canOpenLead && (
                  <a href={`#leads/${photo.leadId}`} onClick={close}>
                    <ExternalLink size={15} /> Abrir ficha de origen
                  </a>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft({
                      caption: photo.caption,
                      tags: photo.tags,
                      sharing: photo.sharing,
                    });
                    setEditing(true);
                  }}
                >
                  <Pencil size={15} /> Editar etiquetas y uso
                </Button>
                {photo.sharing === "clients" && (
                  <Button onClick={() => setPresenting(true)}>
                    <Presentation size={16} /> Mostrar al cliente
                  </Button>
                )}
              </div>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
