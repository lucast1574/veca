import type { Metadata } from "next";
import { SiteFooter } from "../../components/SiteChrome";
import { GalleryPage } from "../../components/GalleryPage";

export const metadata: Metadata = {
  title: "Galería VECA",
  alternates: { canonical: "/galeria/" },
};

export default function GallerySupport() {
  return (
    <>
      <GalleryPage title="Galería VECA">
        <p>
          Consulta las fotos de obra y proyectos de tu equipo desde el celular
          con tu cuenta del panel de Vidrios VECA.
        </p>
        <p>
          Si necesitas ayuda para acceder o ver las fotos, escríbenos a{" "}
          <a href="mailto:ventas@veca.com.pe">ventas@veca.com.pe</a>.
        </p>
        <div className="ve-gallery-utility">
          <a href="/privacidad/">Política de privacidad</a>
          <a href="/eliminar-cuenta/">Eliminar cuenta</a>
        </div>
      </GalleryPage>
      <SiteFooter />
    </>
  );
}
