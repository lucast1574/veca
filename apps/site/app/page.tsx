import {
  INITIAL_LANDING_SHOWCASE,
  initialLandingProjects,
  SOLUTION_SLOTS,
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
export default async function Home() {
  const [portfolio, regionalWork, caseStudy, office, ...solutions] =
    await Promise.all([
      landingProjects(),
      api<Project>("/public/projects/jw-marriott-el-convento-882bdb").catch(
        () => null,
      ),
      api<Project>("/public/projects/clinica-procabell-882c61").catch(
        () => null,
      ),
      api<Project>("/public/projects/oficinas-onu-882c3e").catch(() => null),
      ...SOLUTION_SLOTS.map((slot) =>
        projects({ solutionSlot: slot.id }).catch(() => null),
      ),
    ]);
  return (
    <>
      <VecaLanding
        intro={<QuoteIntro project={regionalWork ?? undefined} />}
        caseStudy={caseStudy && <FeaturedCase project={caseStudy} />}
        company={<CompanyIntro office={office ?? undefined} />}
        featured={<FeaturedProjects items={portfolio.map(withHomeCover)} />}
        solutionProjects={solutions.flatMap(
          (result) => result?.items.slice(0, 1).map(withHomeCover) ?? [],
        )}
        consultationUrl={`${process.env.PUBLIC_API_URL || "https://api.veca.com.pe"}/public/consultations`}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeSchema) }}
      />
    </>
  );
}
