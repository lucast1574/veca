"use client";

import { CATEGORIES, type Project } from "@veca/content";
import { Icon } from "@veca/ui/src/Icon";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const rotationInterval = 2600;
const interactionCooldown = 3800;

function scrollProjects(list: HTMLUListElement, direction: -1 | 1) {
  const cards = Array.from(list.children) as HTMLLIElement[];
  const [first, second] = cards;
  if (!second) return;
  const step = second.offsetLeft - first.offsetLeft;
  if (step <= 0) return;

  const visible = Math.max(1, Math.round(list.clientWidth / step));
  const position = Math.round(list.scrollLeft / step);
  const last = Math.max(0, cards.length - visible);
  const next = Math.max(0, Math.min(last, position + direction * visible));
  list.scrollTo({ left: cards[next].offsetLeft - first.offsetLeft });
}

export function FeaturedProjectCarousel({ items }: { items: Project[] }) {
  const track = useRef<HTMLUListElement>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const lastInteraction = useRef(0);
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

  useEffect(() => {
    const list = track.current;
    const frame = carousel.current;
    if (!list || !frame || items.length < 2) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let direction: -1 | 1 = 1;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.intersectionRatio >= 0.45;
      },
      { threshold: 0.45 },
    );
    observer.observe(list);

    const timer = window.setInterval(() => {
      if (
        !visible ||
        document.hidden ||
        reducedMotion.matches ||
        frame.matches(":hover, :focus-within") ||
        Date.now() - lastInteraction.current < interactionCooldown
      )
        return;

      const maxScroll = list.scrollWidth - list.clientWidth;
      if (maxScroll < 2) return;
      if (list.scrollLeft >= maxScroll - 1) direction = -1;
      if (list.scrollLeft <= 1) direction = 1;
      scrollProjects(list, direction);
    }, rotationInterval);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [items.length]);

  function noteInteraction() {
    lastInteraction.current = Date.now();
  }

  function move(direction: -1 | 1) {
    if (track.current) scrollProjects(track.current, direction);
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
      ref={carousel}
      onPointerDown={noteInteraction}
      onWheel={(event) => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) noteInteraction();
      }}
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
