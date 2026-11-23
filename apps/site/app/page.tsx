import {
  INITIAL_LANDING_SHOWCASE,
  initialLandingProjects,
  SOLUTION_SLOTS,
  LANDING_FIXED_PROJECTS,
  type LandingContent,
  type Project,
} from "@veca/content";
import { homeSchema } from "../lib/home-schema";
import { withHomeCover } from "../lib/home-cover";
import { api, ApiError, projects } from "../lib/api";
import { FeaturedProjects } from "../components/FeaturedProjects";
import { VecaLanding } from "../components/VecaLanding";
import {
  CompanyIntro,
  FeaturedCase,
  QuoteIntro,
} from "../components/landing/WorkFeature";
import "./landing.css";
import "./landing-proof.css";
export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: "https://veca.com.pe/" } };
async function landingProjects() {
  try {
    return await api<Project[]>("/public/landing-projects");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) return [];
    // The site and API can be deployed independently.
    const [featured, showcase] = await Promise.all([
      projects({ featured: "true" }).catch(() => null),
      Promise.all(
        INITIAL_LANDING_SHOWCASE.map((slug) =>
          api<Project>("/public/projects/" + slug).catch(() => null),
        ),
      ),
    ]);
    return initialLandingProjects(featured?.items ?? [], showcase);
  }
}
async function landingContent(): Promise<LandingContent> {
  try {
    return await api<LandingContent>("/public/landing-content");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404)
      return { carousel: [], projects: {} };
    // The site and API can be deployed independently.
    const [carousel, fixed, solutions] = await Promise.all([
      landingProjects(),
      Promise.all(
        Object.entries(LANDING_FIXED_PROJECTS).map(async ([id, slug]) => {
          const project = await api<Project>("/public/projects/" + slug).catch(
            () => null,
          );
          return [id, project] as const;
        }),
      ),
      Promise.all(
        SOLUTION_SLOTS.map(async ({ id }) => {
          const result = await projects({ solutionSlot: id }).catch(() => null);
          return [id, result?.items[0] ?? null] as const;
        }),
      ),
    ]);
    return {
      carousel,
      projects: Object.fromEntries(
        [...fixed, ...solutions].filter(([, project]) => project !== null),
      ),
    };
  }
}
export default async function Home() {
  const { carousel, projects: featured } = await landingContent();
  const solutionProjects = Object.fromEntries(
    SOLUTION_SLOTS.flatMap(({ id }) => {
      const project = featured[id];
      return project ? [[id, withHomeCover(project)]] : [];
    }),
  );
  return (
    <>
      <VecaLanding
        intro={<QuoteIntro project={featured.quote} />}
        caseStudy={
          featured.caseStudy && <FeaturedCase project={featured.caseStudy} />
        }
        company={<CompanyIntro office={featured.company} />}
        featured={<FeaturedProjects items={carousel.map(withHomeCover)} />}
        solutionProjects={solutionProjects}
        consultationUrl={`${process.env.PUBLIC_API_URL || "https://api.veca.com.pe"}/public/consultations`}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeSchema) }}
      />
    </>
  );
}
