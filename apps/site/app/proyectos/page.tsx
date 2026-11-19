import { permanentRedirect } from "next/navigation";
import {
  collectionHref,
  type ProjectSearch,
} from "../../lib/project-collection";
import { ProjectCollection } from "../../components/ProjectCollection";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ProjectSearch>;
}) {
  const p = await searchParams;
  return {
    title: "Proyectos de vidrio en Lima y provincias",
    description:
      "Explora las ventanas, mamparas, fachadas y remodelaciones de Vidrios VECA en Lima y provincias.",
    alternates: { canonical: "https://veca.com.pe/proyectos/" },
    robots: p.q || p.tag ? { index: false, follow: true } : undefined,
  };
}
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<ProjectSearch>;
}) {
  const p = await searchParams;
  if (p.page !== undefined) permanentRedirect(collectionHref("/proyectos/", p));
  return <ProjectCollection q={p.q} tag={p.tag} />;
}
