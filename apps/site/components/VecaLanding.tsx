"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Project } from "@veca/content";
import { SiteFooter } from "./SiteChrome";
import { Icon } from "@veca/ui/src/Icon";
import { WHATSAPP, questions } from "./landing/content";
import { Arrow, Action } from "./landing/Controls";
import { SolutionExplorer } from "./landing/SolutionExplorer";
import { LandingNavigation } from "./landing/LandingNavigation";
import { LogoEntrance } from "./landing/LogoEntrance";
import { ProjectContact } from "./landing/ProjectContact";
export function VecaLanding({
  featured,
  company,
  caseStudy,
  consultationUrl,
  solutionProjects = [],
}: {
  featured: ReactNode;
  company: ReactNode;
  caseStudy: ReactNode;
  consultationUrl: string;
  solutionProjects?: Project[];
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      node.dataset.motion = preference.matches ? "reduced" : "full";
    };
    update();
    preference.addEventListener("change", update);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("ve-in-view");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.12 },
    );
    node.querySelectorAll(".ve-observe").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
    };
  }, []);
  return (
    <div className="ve-home" ref={root}>
      <LogoEntrance />
      <LandingNavigation home />
      <main id="contenido">
        <section className="ve-hero" id="inicio" aria-labelledby="ve-title">
          <a
            className="ve-hero-brand"
            href="#inicio"
            aria-label="Vidrios VECA, inicio"
          >
            <img
              src="/assets/logo.svg"
              alt="Vidrios VECA"
              width="128"
              height="83"
            />
          </a>
          <div className="ve-hero-image">
            <img
              src="/assets/facade.webp"
              alt="Perspectiva de una fachada acristalada hacia el cielo"
              width="1600"
              height="1067"
              fetchPriority="high"
            />
            <div className="ve-hero-shade" />
          </div>
          <div className="ve-hero-content">
            <p className="ve-hero-location">
              <span />
              Vidrios VECA · Lima, Perú
            </p>
            <h1 id="ve-title">
              Tu espacio.
              <br />
              Otra perspectiva.
            </h1>
            <div className="ve-hero-bottom">
              <p>
                Transformamos ideas en espacios
                <br />
                que se abren a la luz.
              </p>
              <Action href="#soluciones">Descubre las posibilidades</Action>
            </div>
          </div>
        </section>
        <section
          className="ve-project-intro ve-section"
          aria-labelledby="ve-project-intro-title"
        >
          <div className="ve-proof-inner ve-project-intro-inner">
            <div>
              <h2 id="ve-project-intro-title">
                Instalación de vidrio y aluminio en Lima
              </h2>
              <p>
                Ventanas, mamparas y fachadas para viviendas, edificios y
                comercios.
              </p>
            </div>
            <div className="ve-project-intro-actions">
              <Action href="#contacto" light>
                Cotiza tu proyecto
              </Action>
              <a className="ve-proof-link" href="#proyectos">
                Ver obras realizadas <Arrow />
              </a>
            </div>
          </div>
        </section>
        {featured}
        <SolutionExplorer projects={solutionProjects} />
        {caseStudy}
        {company}
        <section className="ve-faq ve-section" aria-labelledby="ve-faq-title">
          <div>
            <h2 id="ve-faq-title">Preguntas frecuentes</h2>
            <a
              className="ve-inline-link"
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
            >
              Tengo otra consulta <Arrow />
            </a>
          </div>
          <div className="ve-questions">
            {questions.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Icon name="plus" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <ProjectContact submissionUrl={consultationUrl} />
      </main>
      <SiteFooter />
    </div>
  );
}
