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
  const published = !isLead && photo.publication.status === "published";
  const clients = isLead && photo.sharing === "clients";
  const BadgeIcon = isLead
    ? clients
      ? ShieldCheck
      : LockKeyhole
    : published
      ? Globe
      : FileText;
  const label = isLead
    ? clients
      ? "Para clientes"
      : "Uso interno"
    : published
      ? "En la web"
      : "En borrador";
  const title =
    photo.caption ||
    (isLead ? photo.name : photo.alt || photo.publication.title);
  const category = isLead
    ? REQUEST_TYPES.find((item) => item.id === photo.lead.requestType)?.name
    : CATEGORIES.find((item) => item.id === photo.publication.category)?.name;
  const location = isLead ? photo.lead.district : photo.publication.location;

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
        <p>
          {[isLead ? "Obra" : "Sitio web", category, location]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h2>{title}</h2>
        {isLead && photo.tags.length > 0 && (
          <div className="gallery-photo-tags">
            {photo.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        <footer>
          <span>{isLead ? photo.lead.name : photo.publication.title}</span>
          <span>
            {isLead
              ? LEAD_STAGES.find((item) => item.id === photo.lead.stage)?.name
              : photo.publication.cover
                ? "Portada"
                : "Foto del proyecto"}
          </span>
        </footer>
      </div>
    </button>
  );
}
