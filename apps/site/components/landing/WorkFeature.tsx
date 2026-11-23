import { LANDING_FIXED_PROJECTS, type Project } from "@veca/content";
import { Icon } from "@veca/ui/src/Icon";
import { Action, Arrow } from "./Controls";

type ProjectImage = Project["images"][number];

function WorkPhoto({
  image,
  main = false,
}: {
  image: ProjectImage;
  main?: boolean;
}) {
  return (
    <figure className={main ? "ve-case-main" : undefined}>
      <img
        src={image.url}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        style={{ objectPosition: `${image.positionX}% ${image.positionY}%` }}
      />
      {image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>
  );
}

export function FeaturedCase({ project }: { project: Project }) {
  const original = project.slug === LANDING_FIXED_PROJECTS.caseStudy;
  const main =
    (original &&
      project.images.find(
        (image) => image.id === "6afe88112b79ec6d83882c5e",
      )) ||
    project.images.find((image) => image.id === project.coverId);
  const details = original
    ? ["6afe88112b79ec6d83882c5d", "6afe88112b79ec6d83882c5f"].flatMap((id) =>
        project.images.filter((image) => image.id === id),
      )
    : project.images.filter(({ id }) => id !== main?.id).slice(0, 2);
  const description = original
    ? "Vidrio y aluminio para la fachada y los accesos de la clínica."
    : project.excerpt;

  return (
    <section
      className="ve-case ve-section"
      aria-labelledby="ve-case-title"
      id="obra-destacada"
    >
      <div className="ve-proof-inner ve-case-layout">
        <div className="ve-case-copy">
          <p className="ve-case-location">{project.location}</p>
          <h2 id="ve-case-title">{project.title}</h2>
          {description && <p>{description}</p>}
          {original && (
            <div className="ve-case-scope">
              <h3>Qué instalamos</h3>
              <ul>
                <li>Muro cortina Stick 45</li>
                <li>Ventanas proyectantes</li>
                <li>Puertas de cristal templado</li>
                <li>Cortavientos</li>
              </ul>
            </div>
          )}
          <Action href={`/proyectos/${project.slug}/`} light>
            Ver la obra completa
          </Action>
        </div>
        {main && (
          <div className="ve-case-gallery">
            <WorkPhoto image={main} main />
            <div className="ve-case-details">
              {details.map((image) => (
                <WorkPhoto key={image.id} image={image} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function CompanyIntro({ office }: { office?: Project | null }) {
  const image =
    (office?.slug === LANDING_FIXED_PROJECTS.company &&
      office.images.find((photo) => photo.id === "6afe87b02b79ec6d83882c3d")) ||
    office?.images.find((photo) => photo.id === office.coverId);
  return (
    <section
      className="ve-company ve-section"
      id="nosotros"
      aria-labelledby="ve-about-title"
    >
      <div className="ve-proof-inner ve-company-layout">
        <div className="ve-company-copy">
          <h2 id="ve-about-title">Vidrios VECA, desde San Luis</h2>
          <p>
            Instalamos ventanas, mamparas y soluciones de fachada para
            viviendas, edificios y locales comerciales en Lima y provincias.
          </p>
          <p>
            Al conversar sobre tu proyecto revisamos el uso del espacio, las
            medidas y el acabado que buscas.
          </p>
          <Action href="#contacto">Cuéntanos sobre tu obra</Action>
        </div>
        {image && office && (
          <figure className="ve-company-photo">
            <img
              src={image.url}
              alt={image.alt}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              <a href={`/proyectos/${office.slug}/`}>{office.title}</a>
              <span>{office.location}</span>
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}

export function QuoteIntro({ project }: { project?: Project }) {
  const image = project?.images.find((entry) => entry.id === project.coverId);
  return (
    <section
      className="ve-project-intro ve-section ve-observe"
      aria-labelledby="ve-project-intro-title"
    >
      <div className="ve-proof-inner ve-project-intro-inner">
        <div className="ve-quote-copy">
          <h2 id="ve-project-intro-title">Cotiza tu instalación</h2>
          <p>
            Instalamos ventanas, mamparas y fachadas de vidrio. Cuéntanos qué
            necesitas y dónde está tu obra.
          </p>
          <p className="ve-quote-coverage">
            <Icon name="map-pin" />
            Proyectos en Lima y provincias
          </p>
          <div className="ve-project-intro-actions">
            <Action href="#contacto">Solicitar cotización</Action>
            <a className="ve-proof-link" href="#proyectos">
              Ver obras realizadas <Arrow />
            </a>
          </div>
        </div>
        <figure className="ve-quote-photo">
          <div className="ve-quote-frame">
            <img
              src={image?.url ?? "/assets/oficina.webp"}
              alt={image?.alt ?? "Oficina con amplios paneles de vidrio"}
              width={image?.width ?? 1200}
              height={image?.height ?? 1600}
              loading="lazy"
              decoding="async"
              style={
                image && {
                  objectPosition: `${image.positionX}% ${image.positionY}%`,
                }
              }
            />
          </div>
          {image && project ? (
            <figcaption>
              <a href={`/proyectos/${project.slug}/`}>
                <span>
                  <strong>{project.title}</strong>
                  <span>{project.location}</span>
                </span>
                <Arrow />
              </a>
            </figcaption>
          ) : (
            <figcaption>Imagen de referencia</figcaption>
          )}
        </figure>
      </div>
    </section>
  );
}
