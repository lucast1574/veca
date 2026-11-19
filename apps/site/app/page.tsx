import { SOLUTION_SLOTS, type Project } from "@veca/content";
import { homeSchema } from "../lib/home-schema";
import { withHomeCover } from "../lib/home-cover";
import { api, projects } from "../lib/api";
import { FeaturedProjects } from "../components/FeaturedProjects";
import { VecaLanding } from "../components/VecaLanding";
import { CompanyIntro, FeaturedCase } from "../components/landing/WorkFeature";
import "./landing.css";
import "./landing-proof.css";
export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: "https://veca.com.pe/" } };
const showcaseProjects = [
  "edificio-multifamiliar-madre-selva-882bc0",
  "oficinas-onu-882c3e",
  "edificio-multifamiliar-home-life-882be6",
  "subaru-javier-prado-882c26",
  "sarcletti-jorge-chavez-882c29",
  "clinica-procabell-882c61",
  "edificio-multifamiliar-top-818-882c20",
  "edificio-multifamiliar-greenleaf-882bcf",
  "diners-club-882be1",
];

export default async function Home() {
  const [result, showcases, ...solutions] = await Promise.all([
    projects({ featured: "true" }).catch(() => null),
    Promise.all(
      showcaseProjects.map((slug) =>
        api<Project>("/public/projects/" + slug).catch(() => null),
      ),
    ),
    ...SOLUTION_SLOTS.map((slot) =>
      projects({ solutionSlot: slot.id }).catch(() => null),
    ),
  ]);
  const featured = result?.items ?? [];
  const featuredIds = new Set(featured.map((item) => item.id));
  const portfolio = [
    ...featured,
    ...showcases.filter(
      (item): item is Project => item !== null && !featuredIds.has(item.id),
    ),
  ];
  const caseStudy = portfolio.find(
    ({ slug }) => slug === "clinica-procabell-882c61",
  );
  const office = portfolio.find(({ slug }) => slug === "oficinas-onu-882c3e");
  return (
    <>
      <VecaLanding
        caseStudy={caseStudy && <FeaturedCase project={caseStudy} />}
        company={<CompanyIntro office={office} />}
        featured={
          <FeaturedProjects items={portfolio.slice(0, 12).map(withHomeCover)} />
        }
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
