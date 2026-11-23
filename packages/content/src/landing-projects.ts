import type { Project } from "./index.js";

export const LANDING_PROJECT_LIMIT = 12;

export const INITIAL_LANDING_SHOWCASE = [
  "edificio-multifamiliar-madre-selva-882bc0",
  "oficinas-onu-882c3e",
  "terrapuerto-selva-central-882c59",
  "edificio-multifamiliar-home-life-882be6",
  "subaru-javier-prado-882c26",
  "sarcletti-jorge-chavez-882c29",
  "clinica-procabell-882c61",
  "edificio-multifamiliar-top-818-882c20",
  "edificio-multifamiliar-greenleaf-882bcf",
  "diners-club-882be1",
] as const;

export type LandingProjectSelection = {
  revision: number;
  items: { id: string; title: string; published: boolean }[];
};

export function initialLandingProjects(
  featured: (Project | null)[],
  showcase: (Project | null)[],
) {
  const highlighted = featured.filter((project) => project !== null);
  const featuredIds = new Set(highlighted.map(({ id }) => id));
  return [
    ...highlighted,
    ...showcase.filter(
      (project): project is Project =>
        project !== null && !featuredIds.has(project.id),
    ),
  ].slice(0, LANDING_PROJECT_LIMIT);
}
