import type { Metadata } from "next";
import { SiteFooter } from "../../components/SiteChrome";
import { galleryApi } from "../../lib/gallery-account";
import { GalleryPage } from "../../components/GalleryPage";
import { DeleteAccount } from "./DeleteAccount";

export const metadata: Metadata = {
  title: "Eliminar cuenta de Galería VECA",
  alternates: { canonical: "/eliminar-cuenta/" },
};

export default function AccountDeletion() {
  return (
    <>
      <GalleryPage title="Eliminar cuenta">
        <p>
          Elimina tu cuenta de Galería VECA y del panel con el mismo acceso que
          usas para iniciar sesión.
        </p>
        <DeleteAccount api={galleryApi} />
        <p>
          Eliminamos el perfil, la foto de perfil, las credenciales y las
          sesiones. Conservamos los registros necesarios para la operación de
          las obras y el cumplimiento de obligaciones aplicables. Consulta
          nuestra <a href="/privacidad/">política de privacidad</a>.
        </p>
      </GalleryPage>
      <SiteFooter />
    </>
  );
}
