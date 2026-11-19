import { notFound, permanentRedirect } from "next/navigation";
import { CATEGORIES } from "@veca/content";
import {
  collectionHref,
  type ProjectSearch,
} from "../../../../lib/project-collection";
import { ProjectCollection } from "../../../../components/ProjectCollection";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ category: string }>;
  searchParams: Promise<ProjectSearch>;
};
export async function generateMetadata({ params, searchParams }: Props) {
  const { category } = await params;
  const p = await searchParams;
  const c = CATEGORIES.find((c) => c.id === category);
  if (!c) notFound();
  return {
    title: `Proyectos de ${c.name.toLowerCase()}`,
    description: `${c.description}. Explora las obras de Vidrios VECA.`,
    alternates: {
      canonical: `https://veca.com.pe/proyectos/categoria/${category}/`,
    },
    robots: p.q || p.tag ? { index: false, follow: true } : undefined,
  };
}
export default async function Category({ params, searchParams }: Props) {
  const { category } = await params;
  if (!CATEGORIES.some((c) => c.id === category)) notFound();
  const p = await searchParams;
  if (p.page !== undefined) {
    permanentRedirect(collectionHref(`/proyectos/categoria/${category}/`, p));
  }
  return <ProjectCollection category={category} q={p.q} tag={p.tag} />;
}
