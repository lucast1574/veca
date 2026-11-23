import type { Project } from "./index.js";

export const SOLUTION_SLOTS = [
  { id: "viviendas", name: "Viviendas" },
  { id: "edificios", name: "Edificios" },
  { id: "interiores", name: "Interiores" },
  { id: "remodelaciones", name: "Remodelaciones" },
] as const;
export const LANDING_FIXED_PROJECTS = {
  quote: "jw-marriott-el-convento-882bdb",
  caseStudy: "clinica-procabell-882c61",
  company: "oficinas-onu-882c3e",
} as const;

export type SolutionSlot = (typeof SOLUTION_SLOTS)[number]["id"];
export type FixedLandingPlacement = keyof typeof LANDING_FIXED_PROJECTS;
export type LandingPlacementId = FixedLandingPlacement | SolutionSlot;
export type LandingPlacements<T> = Partial<Record<LandingPlacementId, T>>;
export const LANDING_PLACEMENT_IDS: LandingPlacementId[] = [
  "quote",
  "caseStudy",
  "company",
  ...SOLUTION_SLOTS.map(({ id }) => id),
];

export type LandingContent = {
  carousel: Project[];
  projects: LandingPlacements<Project>;
};

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

export type LandingProjectItem = {
  id: string;
  title: string;
  published: boolean;
};
export type LandingProjectSelection = {
  revision: number;
  items: LandingProjectItem[];
  placements: LandingPlacements<{
    automatic: boolean;
    project: LandingProjectItem | null;
  }>;
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
