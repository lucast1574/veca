"use client";

import type { Project } from "@veca/content";
import { useRef, useState } from "react";
import { spaces } from "./content";
import { Action, Arrow } from "./Controls";

export function SolutionExplorer({ projects = [] }: { projects?: Project[] }) {
  const [active, setActive] = useState(0);
  const item = spaces[active];
  const project = projects.find((entry) => entry.solutionSlot === item.id);
  const cover = project?.images.find((image) => image.id === project.coverId);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <section
      className="ve-solutions ve-section"
      id="soluciones"
      aria-labelledby="ve-solutions-title"
    >
      <div className="ve-proof-inner ve-solution-inner">
        <h2 id="ve-solutions-title">¿Qué quieres instalar?</h2>
        <div className="ve-solution-layout">
          <div
            className="ve-service-tabs"
            role="tablist"
            aria-label="Soluciones de vidrio y aluminio"
          >
            {spaces.map((space, i) => (
              <button
                type="button"
                key={space.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                id={`ve-tab-${i}`}
                role="tab"
                aria-selected={active === i}
                aria-controls="ve-solution-panel"
                tabIndex={active === i ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => {
                  const offset = ["ArrowRight", "ArrowDown"].includes(e.key)
                    ? 1
                    : ["ArrowLeft", "ArrowUp"].includes(e.key)
                      ? -1
                      : 0;
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? spaces.length - 1
                        : offset
                          ? (i + offset + spaces.length) % spaces.length
                          : i;
                  if (!offset && e.key !== "Home" && e.key !== "End") return;
                  e.preventDefault();
                  setActive(next);
                  tabs.current[next]?.focus();
                }}
              >
                <span>
                  <strong>{space.title}</strong>
                  <small>{space.name}</small>
                </span>
                <Arrow direction="right" />
              </button>
            ))}
          </div>
          <div
            className="ve-service-panel"
            id="ve-solution-panel"
            role="tabpanel"
            aria-labelledby={`ve-tab-${active}`}
          >
            <div className="ve-service-copy">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <ul>
                {item.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <Action href="#contacto">Cotizar esta solución</Action>
            </div>
            {cover && project ? (
              <a
                className="ve-service-example"
                href={`/proyectos/${project.slug}/`}
              >
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
                <span className="ve-service-caption">
                  <span>
                    <strong>{project.title}</strong>
                    <small>{project.location}</small>
                  </span>
                  <Arrow />
                </span>
              </a>
            ) : (
              <a className="ve-service-example" href={item.href}>
                <img
                  src={`/assets/${item.image}`}
                  alt={item.alt}
                  width={1600}
                  height={1067}
                  loading="lazy"
                  decoding="async"
                />
                <span className="ve-service-caption">
                  <span>
                    <strong>Conoce el servicio</strong>
                    <small>Imagen de referencia</small>
                  </span>
                  <Arrow />
                </span>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
