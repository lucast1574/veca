import { Icon } from "@veca/ui/src/Icon";
import { CATEGORIES, type Project } from "@veca/content";
import { FeaturedProjectCarousel } from "./FeaturedProjectCarousel";
import "../app/home-work.css";

export function FeaturedProjects({ items }: { items: Project[] }) {
  return (
    <section
      className="home-work"
      id="proyectos"
      aria-labelledby="home-work-title"
    >
      <div className="home-work-inner">
        <header className="home-work-heading">
          <div>
            <h2 id="home-work-title">Cada proyecto, otra perspectiva.</h2>
          </div>
          <p>
            Ventanas, mamparas y fachadas de vidrio en obras realizadas en Lima
            y provincias.
          </p>
        </header>
        {!!items.length && <FeaturedProjectCarousel items={items} />}
        <div className="home-work-footer">
          <nav
            className="home-work-categories"
            aria-label="Categorías de proyectos"
          >
            <p>Explora por categoría</p>
            <ul>
              {CATEGORIES.map((category) => (
                <li key={category.id}>
                  <a href={`/proyectos/categoria/${category.id}/`}>
                    {category.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <a className="home-work-all" href="/proyectos/">
            {items.length ? "Ver todos los proyectos" : "Entra a la galería"}
            <Icon name="arrow-up-right" size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}
