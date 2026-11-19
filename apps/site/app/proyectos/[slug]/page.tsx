import { Icon } from "@veca/ui/src/Icon";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CATEGORIES,
  matchPeruLocation,
  regionName,
  seoFor,
  type Project,
} from "@veca/content";
import { ProjectArticle } from "@veca/ui";
import { api } from "../../../lib/api";
import { SiteHeader, SiteFooter } from "../../../components/SiteChrome";
export const dynamic = "force-dynamic";
async function get(slug: string) {
  try {
    const project = await api<Project>(
      "/public/projects/" + encodeURIComponent(slug),
    );
    return { ...project, seo: seoFor(project, project.slug) };
  } catch (e) {
    if ((e as Error).message === "API 404") notFound();
    throw e;
  }
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const project = await get((await params).slug);
  const cover = project.images.find(({ id }) => id === project.coverId);
  const image = cover && {
    url: cover.url,
    width: cover.width,
    height: cover.height,
    alt: cover.alt || project.title,
  };
  return {
    title: { absolute: project.seo.title },
    description: project.seo.description,
    alternates: { canonical: project.seo.canonical },
    robots: { index: true, follow: true, "max-image-preview": "large" },
    openGraph: {
      title: project.seo.title,
      description: project.seo.description,
      type: "article",
      url: project.seo.canonical,
      siteName: "Vidrios VECA",
      locale: "es_PE",
      section: CATEGORIES.find(({ id }) => id === project.category)?.name,
      authors: ["https://veca.com.pe/"],
      tags: project.tags,
      publishedTime: project.publishedAt || undefined,
      modifiedTime: project.updatedAt,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: project.seo.title,
      description: project.seo.description,
      images: image ? [{ url: image.url, alt: image.alt }] : undefined,
    },
  };
}
export default async function Article({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const project = await get((await params).slug);
  const canonical = project.seo.canonical;
  const category = CATEGORIES.find(({ id }) => id === project.category);
  const location = matchPeruLocation(project.location || "");
  const cover = project.images.find(({ id }) => id === project.coverId);
  const image = cover && {
    "@type": "ImageObject",
    url: cover.url,
    width: cover.width,
    height: cover.height,
    ...(cover.caption && { caption: cover.caption }),
  };
  const breadcrumbs = [
    { name: "Inicio", url: "https://veca.com.pe/" },
    { name: "Proyectos", url: "https://veca.com.pe/proyectos/" },
    ...(category
      ? [
          {
            name: category.name,
            url: `https://veca.com.pe/proyectos/categoria/${category.id}/`,
          },
        ]
      : []),
    { name: project.title, url: canonical },
  ];
  const organization = {
    "@type": "Organization",
    "@id": "https://veca.com.pe/#organization",
    name: "Vidrios VECA",
    url: "https://veca.com.pe/",
    logo: {
      "@type": "ImageObject",
      url: "https://veca.com.pe/assets/logo.svg",
    },
  };
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "Article",
        "@id": canonical + "#article",
        url: canonical,
        headline: project.title,
        description: project.seo.description,
        image,
        datePublished: project.publishedAt || undefined,
        dateModified: project.updatedAt,
        author: { "@id": organization["@id"] },
        publisher: { "@id": organization["@id"] },
        mainEntityOfPage: canonical,
        inLanguage: "es-PE",
        articleSection: category?.name,
        keywords: project.tags.length ? project.tags.join(", ") : undefined,
        contentLocation: project.location && {
          "@type": "Place",
          name: project.location,
          ...(location && {
            address: {
              "@type": "PostalAddress",
              addressCountry: "PE",
              addressRegion: regionName(location.region),
              addressLocality: location.locality || undefined,
            },
          }),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map(({ name, url }, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name,
          item: url,
        })),
      },
    ],
  };
  return (
    <>
      <SiteHeader />
      <main id="contenido">
        <nav className="article-breadcrumb" aria-label="Ruta de navegación">
          <ol>
            {breadcrumbs.map(({ name, url }, index) => (
              <li key={url}>
                {index === breadcrumbs.length - 1 ? (
                  <span aria-current="page">{name}</span>
                ) : (
                  <a href={url}>{name}</a>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <ProjectArticle project={project} />
        <section className="project-next section-pad">
          <p className="eyebrow">TU ESPACIO, TU PRÓXIMO PROYECTO</p>
          <h2>
            ¿Imaginamos algo
            <br />
            para ti?
          </h2>
          <a className="button button-orange" href="https://wa.me/51908917621">
            Conversemos por WhatsApp{" "}
            <span>
              <Icon name="arrow-up-right" />
            </span>
          </a>
        </section>
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
