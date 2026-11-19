"use client";

import { CATEGORIES, type Project } from "@veca/content";
import { Icon } from "@veca/ui/src/Icon";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const rotationInterval = 2600;
const interactionCooldown = 3800;
const maxVisibleCards = 3;
const scrollSettleDelay = 120;

function measureTrack(list: HTMLUListElement, firstOriginal: number) {
  const cards = Array.from(list.children) as HTMLLIElement[];
  const [first, second] = cards;
  if (!second) return null;

  const step = second.offsetLeft - first.offsetLeft;
  if (step <= 0) return null;

  return {
    visible: Math.max(1, Math.round(list.clientWidth / step)),
    index: Math.round(
      (list.scrollLeft - cards[firstOriginal].offsetLeft + first.offsetLeft) /
        step,
    ),
    offset: (index: number) =>
      cards[firstOriginal + index].offsetLeft - first.offsetLeft,
  };
}

function scrollGroup(
  list: HTMLUListElement,
  cloneCount: number,
  count: number,
  direction: -1 | 1,
) {
  const layout = measureTrack(list, cloneCount);
  if (!layout) return;
  const next = Math.max(
    -layout.visible,
    Math.min(count, layout.index + direction * layout.visible),
  );
  list.scrollTo({ left: layout.offset(next) });
}

export function FeaturedProjectCarousel({ items }: { items: Project[] }) {
  const track = useRef<HTMLUListElement>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const lastInteraction = useRef(0);
  const currentIndex = useRef(0);
  const [cloneCount, setCloneCount] = useState(0);
  const count = items.length;
  const loop = cloneCount > 0;

  useLayoutEffect(() => {
    const list = track.current;
    if (!list || count < 2) return;

    function align() {
      if (!list || !list.clientWidth) return;
      const layout = measureTrack(list, cloneCount);
      if (!layout) return;

      const needed =
        count > layout.visible ? Math.min(count, maxVisibleCards) : 0;
      if (needed !== cloneCount) {
        setCloneCount(needed);
      } else if (loop) {
        list.scrollTo({
          left: layout.offset(currentIndex.current),
          behavior: "instant",
        });
      }
    }

    align();
    const observer = new ResizeObserver(align);
    observer.observe(list);
    return () => observer.disconnect();
  }, [cloneCount, count, loop]);

  useEffect(() => {
    const list = track.current;
    if (!list || !loop) return;

    let settleTimer: number;
    function settle() {
      if (!list) return;
      const layout = measureTrack(list, cloneCount);
      if (!layout) return;

      const index = ((layout.index % count) + count) % count;
      currentIndex.current = index;
      if (index !== layout.index) {
        // The copied slides are visually identical when we return to the originals.
        list.scrollTo({ left: layout.offset(index), behavior: "instant" });
      }
    }

    function onScroll() {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, scrollSettleDelay);
    }

    list.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      list.removeEventListener("scroll", onScroll);
      window.clearTimeout(settleTimer);
    };
  }, [cloneCount, count, loop]);

  useEffect(() => {
    const list = track.current;
    const frame = carousel.current;
    if (!list || !frame || !loop) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
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

      scrollGroup(list, cloneCount, count, 1);
    }, rotationInterval);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [cloneCount, count, loop]);

  function noteInteraction() {
    lastInteraction.current = Date.now();
  }

  function move(direction: -1 | 1) {
    if (track.current && loop)
      scrollGroup(track.current, cloneCount, count, direction);
  }

  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget || !loop) return;
    const list = event.currentTarget;
    const layout = measureTrack(list, cloneCount);
    if (!layout) return;
    switch (event.key) {
      case "ArrowLeft":
        move(-1);
        break;
      case "ArrowRight":
        move(1);
        break;
      case "Home":
        list.scrollTo({ left: layout.offset(0) });
        break;
      case "End":
        list.scrollTo({ left: layout.offset(count - layout.visible) });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const hasSeveral = count > 1;
  const slides = [
    ...items
      .slice(count - cloneCount)
      .map((project) => ({ project, copy: "before" })),
    ...items.map((project) => ({ project, copy: "" })),
    ...items
      .slice(0, cloneCount)
      .map((project) => ({ project, copy: "after" })),
  ];
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
            aria-disabled={!loop}
            onClick={() => move(-1)}
          >
            <Icon name="arrow-right" className="home-work-back" size={20} />
          </button>
          <button
            type="button"
            aria-controls="home-work-track"
            aria-label="Proyecto siguiente"
            aria-disabled={!loop}
            onClick={() => move(1)}
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
        {slides.map(({ project, copy }) => {
          const cover = project.images.find(
            (image) => image.id === project.coverId,
          );
          const category = CATEGORIES.find(
            (entry) => entry.id === project.category,
          );
          return (
            <li
              key={copy ? `${project.id}-${copy}` : project.id}
              aria-hidden={copy ? true : undefined}
              inert={copy ? true : undefined}
            >
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
