import type { Project } from "@veca/content";
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
  const main = project.images.find(
    (image) => image.id === "6afe88112b79ec6d83882c5e",
  );
  const details = [
    "6afe88112b79ec6d83882c5d",
    "6afe88112b79ec6d83882c5f",
  ].flatMap((id) => project.images.filter((image) => image.id === id));

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
          <p>Vidrio y aluminio para la fachada y los accesos de la clínica.</p>
          <div className="ve-case-scope">
            <h3>Qué instalamos</h3>
            <ul>
              <li>Muro cortina Stick 45</li>
              <li>Ventanas proyectantes</li>
              <li>Puertas de cristal templado</li>
              <li>Cortavientos</li>
            </ul>
          </div>
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
  const image = office?.images.find(
    (photo) => photo.id === "6afe87b02b79ec6d83882c3d",
  );
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
            viviendas, edificios y locales comerciales en Lima.
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
  const image = project?.images.find(
    (entry) => entry.id === "6afe878a2b79ec6d83882c24",
  );
  return (
    <section
      className="ve-project-intro ve-section"
      aria-labelledby="ve-project-intro-title"
    >
      <div className="ve-proof-inner ve-project-intro-inner">
        <div className="ve-quote-copy">
          <h2 id="ve-project-intro-title">Cotiza tu instalación de vidrio</h2>
          <p>
            Cuéntanos qué necesitas instalar y en qué distrito. Trabajamos
            ventanas, mamparas y fachadas en Lima.
          </p>
          <div className="ve-project-intro-actions">
            <Action href="#contacto">Solicitar cotización</Action>
            <a className="ve-proof-link" href="#proyectos">
              Ver obras realizadas <Arrow />
            </a>
          </div>
        </div>
        {image && project && (
          <figure className="ve-quote-photo">
            <img
              src={image.url}
              alt={image.alt}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              {project.title} · {project.location}
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}
