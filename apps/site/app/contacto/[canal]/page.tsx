import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { socialChannelSchema } from "@veca/content";
import { ProjectContact } from "../../../components/landing/ProjectContact";
import { SiteFooter, SiteHeader } from "../../../components/SiteChrome";

export const metadata: Metadata = {
  title: "Contacto",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function SocialContact({
  params,
}: {
  params: Promise<{ canal: string }>;
}) {
  const source = socialChannelSchema.safeParse((await params).canal);
  if (!source.success) notFound();
  const api = process.env.PUBLIC_API_URL || "https://api.veca.com.pe";
  return (
    <div className="ve-home">
      <SiteHeader />
      <header className="ve-social-contact-header">
        <a href="/" aria-label="Vidrios VECA, inicio">
          <img src="/assets/logo.svg" alt="" width="88" height="57" />
        </a>
      </header>
      <main id="contenido">
        <ProjectContact
          source={source.data}
          submissionUrl={`${api}/public/consultations/social`}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
