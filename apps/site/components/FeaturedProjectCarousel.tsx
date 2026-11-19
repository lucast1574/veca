"use client";

import { CATEGORIES, type Project } from "@veca/content";
import { Icon } from "@veca/ui/src/Icon";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export function FeaturedProjectCarousel({ items }: { items: Project[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const list = track.current;
    if (!list) return;

    function updateEdges() {
      if (!list) return;
      const start = list.scrollLeft <= 1;
      const end = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
      setEdges((previous) =>
        previous.start === start && previous.end === end
          ? previous
          : { start, end },
      );
    }

    const observer = new ResizeObserver(updateEdges);
    observer.observe(list);
    list.addEventListener("scroll", updateEdges, { passive: true });
    updateEdges();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", updateEdges);
    };
  }, [items.length]);

  function move(direction: -1 | 1) {
    const list = track.current;
    if (!list) return;
    const cards = Array.from(list.children) as HTMLLIElement[];
    const start = cards[0].offsetLeft;
    const positions = cards.map((card) => card.offsetLeft - start);
    const target =
      direction > 0
        ? positions.find((position) => position > list.scrollLeft + 1)
        : [...positions]
            .reverse()
            .find((position) => position < list.scrollLeft - 1);
    list.scrollTo({ left: target ?? 0 });
  }

  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case "ArrowLeft":
        move(-1);
        break;
      case "ArrowRight":
        move(1);
        break;
      case "Home":
        event.currentTarget.scrollTo({ left: 0 });
        break;
      case "End":
        event.currentTarget.scrollTo({ left: event.currentTarget.scrollWidth });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const hasSeveral = items.length > 1;
  return (
    <div
      className="home-work-carousel"
      role="group"
      aria-label="Obras destacadas"
    >
      {hasSeveral && (
        <div className="home-work-controls">
          <button
            type="button"
            aria-controls="home-work-track"
            aria-label="Proyecto anterior"
            aria-disabled={edges.start}
            onClick={() => {
              if (!edges.start) move(-1);
            }}
          >
            <Icon name="arrow-right" className="home-work-back" size={20} />
          </button>
          <button
            type="button"
            aria-controls="home-work-track"
            aria-label="Proyecto siguiente"
            aria-disabled={edges.end}
            onClick={() => {
              if (!edges.end) move(1);
            }}
          >
            <Icon name="arrow-right" size={20} />
          </button>
        </div>
      )}
      <ul
        className={
          hasSeveral ? "home-work-track" : "home-work-track home-work-single"
        }
        id="home-work-track"
        ref={track}
        tabIndex={hasSeveral ? 0 : undefined}
        onKeyDown={navigate}
        aria-label="Proyectos en portada"
      >
        {items.map((project) => {
          const cover = project.images.find(
            (image) => image.id === project.coverId,
          );
          const category = CATEGORIES.find(
            (entry) => entry.id === project.category,
          );
          return (
            <li key={project.id}>
              <article>
                <a
                  className="home-work-card"
                  href={`/proyectos/${project.slug}/`}
                >
                  <div className="home-work-photo">
                    {cover && (
                      <img
                        src={cover.url}
                        alt={cover.alt}
                        width={cover.width}
                        height={cover.height}
                        loading="lazy"
                        decoding="async"
                        style={{
                          objectPosition: `${cover.positionX}% ${cover.positionY}%`,
                        }}
                      />
                    )}
                  </div>
                  <div className="home-work-caption">
                    <div>
                      <p>
                        {category?.name}
                        {project.location && ` · ${project.location}`}
                      </p>
                      <h3>{project.title}</h3>
                    </div>
                    <Icon name="arrow-up-right" size={21} />
                  </div>
                </a>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
