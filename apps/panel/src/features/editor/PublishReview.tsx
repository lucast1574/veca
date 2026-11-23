import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Globe,
  House,
  SendHorizontal,
  Send,
} from "lucide-react";
import {
  CATEGORIES,
  PAGE_LAYOUTS,
  publicationRequirements,
  LEAD_SOURCE_LABELS,
  SOCIAL_CHANNELS,
  type PublicationRequirement,
  seoFor,
  type Project,
  type ProjectInput,
} from "@veca/content";
import { api, ApiError } from "../../lib/api";
import { Button } from "../../components/ui";
import { Modal } from "../../components/Modal";
import {
  publicationPlacementSummary,
  type PublicationPlacement,
} from "./PublicationPlacement";
export function PublishReview({
  draft,
  slug,
  busy,
  onPublish,
  onEdit,
  updating,
  hasBeenPublished,
  saved,
  placement,
  onEditPlacement,
}: {
  draft: ProjectInput;
  slug: string;
  busy: boolean;
  onPublish: () => void;
  onEdit: (issue: PublicationRequirement) => void;
  updating: boolean;
  hasBeenPublished: boolean;
  saved: Project | null;
  placement?: PublicationPlacement;
  onEditPlacement: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const placementChanges = placement
    ? publicationPlacementSummary(placement)
    : [];
  const issues = publicationRequirements(draft),
    cover = draft.images.find((image) => image.id === draft.coverId),
    seo = seoFor(draft, slug);
  return (
    <section className="publish-review">
      <header className="editor-step-heading">
        <p>03 / PUBLICAR</p>
        <h1>El siguiente paso es compartirlo.</h1>
        <span>
          Revisa los últimos detalles. Al publicar, este proyecto estará
          disponible para quienes visitan la web de VECA.
        </span>
      </header>
      <div className="publish-review-grid">
        <div className="publication-card">
          {cover ? (
            <img
              className="publication-cover"
              src={cover.url}
              alt={cover.alt || "Portada del proyecto"}
              style={{
                objectPosition: `${cover.positionX}% ${cover.positionY}%`,
              }}
            />
          ) : (
            <div className="publication-cover cover-placeholder">
              <Globe size={40} />
              <span>Tu portada aparecerá aquí</span>
            </div>
          )}
          <div className="publication-copy">
            <p>
              {CATEGORIES.find((c) => c.id === draft.category)?.name} ·{" "}
              {draft.location || "Ubicación pendiente"}
            </p>
            <h2>{draft.title || "Tu próximo proyecto"}</h2>
            <span>
              {draft.excerpt || "Un trabajo que cuenta lo que hacemos en VECA."}
            </span>
            <div>
              <span>
                {draft.images.length}{" "}
                {draft.images.length === 1 ? "foto" : "fotos"}
              </span>
              <span>
                {draft.pageLayout === "legacy"
                  ? "Diseño original"
                  : `${draft.sections.length} secciones`}
              </span>
            </div>
          </div>
        </div>
        <div className="publication-checklist">
          <div className="publish-intention">
            <Globe size={24} />
            <h2>
              {issues.length
                ? "Casi listo para salir al mundo."
                : "Todo listo para darlo a conocer."}
            </h2>
            <p>
              {PAGE_LAYOUTS.find((layout) => layout.id === draft.pageLayout)
                ?.name || "Diseño original"}
              . El título, las imágenes y el contenido se publicarán juntos.
            </p>
          </div>
          {issues.length ? (
            <>
              <ul
                className="publish-issues"
                aria-label="Pendientes para publicar"
              >
                {issues.map((issue) => (
                  <li key={issue.message}>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(issue)}
                    >
                      <ArrowLeft size={16} /> {issue.message}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ul className="publish-checks">
              <li>
                <Check size={17} />
                Título y contenido preparados
              </li>
              <li>
                <Check size={17} />
                Portada y fotos con descripción
              </li>
              <li>
                <Check size={17} />
                Diseño elegido y SEO automático
              </li>
            </ul>
          )}
          <section
            className="publication-placement-review"
            aria-label="Cambios en portada"
          >
            <div className="publication-placement-review-heading">
              <House size={18} aria-hidden="true" />
              <div>
                <strong>Portada del sitio</strong>
                <p>
                  {placementChanges.length
                    ? "Se actualizará al publicar."
                    : "Sin cambios elegidos para la portada."}
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={onEditPlacement}>
                Editar selección
              </Button>
            </div>
            {placementChanges.length > 0 && (
              <ul>
                {placementChanges.map((description) => (
                  <li key={description}>{description}</li>
                ))}
              </ul>
            )}
          </section>
          {saved?.socialShareQueuedAt && (
            <SocialDelivery project={saved} key={saved.version} />
          )}
          <div className="publish-final-action">
            <Button
              disabled={busy || !!issues.length}
              onClick={() => {
                if (hasBeenPublished) onPublish();
                else setConfirming(true);
              }}
            >
              <Send size={18} />
              {busy
                ? "Publicando tu proyecto…"
                : updating
                  ? "Publicar cambios"
                  : "Publicar en VECA"}
            </Button>
            <small>Guardar un borrador lo mantiene privado.</small>
          </div>
          <div className="publication-seo">
            <span>ASÍ APARECERÁ EN BUSCADORES</span>
            <strong>{seo.title}</strong>
            <p>{seo.description}</p>
            <small>La indexación depende de los buscadores.</small>
          </div>
        </div>
      </div>
      {confirming && (
        <Modal
          title="¿Publicar esta obra?"
          description="La obra quedará visible en veca.com.pe. Su portada y descripción entrarán a la cola para Instagram, Facebook y LinkedIn. Puedes consultar el resultado de cada red después."
          onClose={() => setConfirming(false)}
          footer={
            <footer className="ve-modal-actions">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button
                disabled={busy || !!issues.length}
                onClick={() => {
                  setConfirming(false);
                  onPublish();
                }}
              >
                <Send size={17} />
                Confirmar publicación
              </Button>
            </footer>
          }
        >
          {placementChanges.length > 0 && (
            <>
              <p>La publicación también aplicará estos cambios en portada.</p>
              <ul>
                {placementChanges.map((location) => (
                  <li key={location}>{location}</li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
export function PublishSuccess({
  project,
  locations,
  onEdit,
  onBack,
}: {
  project: Project;
  locations: string[];
  onEdit: () => void;
  onBack: () => void;
}) {
  return (
    <section className="publication-success" role="status">
      <div className="publication-success-mark">
        <CheckCircle2 size={42} />
      </div>
      <p>YA ES PARTE DE VECA</p>
      <h1>Tu proyecto está publicado.</h1>
      {locations.length > 0 && (
        <div className="publication-placement-summary">
          <strong>Ubicación en portada actualizada</strong>
          <ul>
            {locations.map((location) => (
              <li key={location}>{location}</li>
            ))}
          </ul>
        </div>
      )}
      <h2>{project.title}</h2>
      <span>
        La historia ya tiene su lugar en la web. Puedes compartirla o volver
        cuando quieras para seguir editando.
      </span>
      {project.socialShareQueuedAt && <SocialDelivery project={project} />}
      <div className="publication-success-actions">
        <a
          className="btn btn-primary"
          href={project.seo.canonical}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver proyecto en la web <ArrowUpRight size={17} />
        </a>
        <Button variant="ghost" onClick={onBack}>
          Volver a proyectos
        </Button>
      </div>
      <button type="button" className="publication-edit-link" onClick={onEdit}>
        Seguir editando este proyecto
      </button>
    </section>
  );
}

const deliveryLabels = {
  pending: "Pendiente de envío",
  processing: "En proceso",
  published: "Publicada",
  review: "Requiere revisión",
  retry: "Pendiente de reintento",
};

function SocialDelivery({ project }: { project: Project }) {
  const [states, setStates] = useState(project.socialDelivery);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      if (document.visibilityState !== "hidden") {
        try {
          const current = await api<Project>(`/admin/projects/${project.id}`, {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          });
          if (controller.signal.aborted) return;
          setStates(current.socialDelivery);
          if (
            SOCIAL_CHANNELS.every((channel) => {
              const state = current.socialDelivery?.[channel];
              return state === "published" || state === "review";
            })
          )
            return;
        } catch (error) {
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          )
            return;
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 15_000);
    }

    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [project.id]);

  return (
    <section className="publication-social" aria-label="Publicación en redes">
      <header>
        <SendHorizontal size={17} aria-hidden="true" />
        <strong>Publicación en redes</strong>
      </header>
      <ul aria-live="polite" role="list">
        {SOCIAL_CHANNELS.map((channel) => {
          const state = states?.[channel] || "pending";
          return (
            <li key={channel}>
              <span>{LEAD_SOURCE_LABELS[channel]}</span>
              <span className="social-state" data-state={state}>
                {deliveryLabels[state]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
