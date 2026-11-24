import {
  CATEGORIES,
  LEAD_STAGES,
  REQUEST_TYPES,
  type GalleryPhoto,
} from "@veca/content";
import { FileText, Globe, LockKeyhole, ShieldCheck } from "lucide-react";
import { API_BASE } from "../../lib/api";

export const galleryPhotoUrl = (url: string) =>
  url.startsWith("/") ? API_BASE + url : url;

export function GalleryPhotoCard({
  photo,
  onOpen,
}: {
  photo: GalleryPhoto;
  onOpen: () => void;
}) {
  const isLead = photo.source === "lead";
  const publication = photo.source === "publication" ? photo.publication : null;
  const published = publication?.status === "published";
  const clients = isLead && photo.sharing === "clients";
  const BadgeIcon = clients
    ? ShieldCheck
    : published
      ? Globe
      : publication
        ? FileText
        : LockKeyhole;
  const label = clients
    ? "Para clientes"
    : published
      ? "En la web"
      : publication
        ? "En borrador"
        : "Uso interno";
  const title =
    photo.source === "publication"
      ? photo.caption || photo.alt || photo.publication.title
      : (isLead && photo.caption) || photo.name;
  const category = isLead
    ? REQUEST_TYPES.find((item) => item.id === photo.lead.requestType)?.name
    : CATEGORIES.find(
        (item) =>
          item.id ===
          (photo.source === "upload"
            ? photo.category
            : photo.publication.category),
      )?.name;
  const origin = isLead ? "Obra" : publication ? "Sitio web" : "Foto subida";
  const location = isLead ? photo.lead.district : publication?.location;

  return (
    <button
      type="button"
      className="gallery-card"
      onClick={onOpen}
      aria-label={`Ver foto: ${title}`}
    >
      <div className="gallery-card-image">
        <img src={galleryPhotoUrl(photo.url)} alt="" loading="lazy" />
        <span className={`photo-use${clients ? " photo-use-clients" : ""}`}>
          <BadgeIcon size={13} /> {label}
        </span>
      </div>
      <div className="gallery-card-copy">
        <p>{[origin, category, location].filter(Boolean).join(" · ")}</p>
        <h2>{title}</h2>
        {isLead && photo.tags.length > 0 && (
          <div className="gallery-photo-tags">
            {photo.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        {(isLead || publication) && (
          <footer>
            <span>{isLead ? photo.lead.name : publication?.title}</span>
            <span>
              {isLead
                ? LEAD_STAGES.find((item) => item.id === photo.lead.stage)?.name
                : publication?.cover
                  ? "Portada"
                  : "Foto del proyecto"}
            </span>
          </footer>
        )}
      </div>
    </button>
  );
}
