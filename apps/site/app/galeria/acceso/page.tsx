import type { Metadata } from "next";
import { GalleryPage } from "../../../components/GalleryPage";
import { galleryApi } from "../../../lib/gallery-account";
import { MobileAccess } from "./MobileAccess";

export const metadata: Metadata = {
  title: "Acceso a Galería VECA",
  robots: { index: false, follow: false },
};
export default function GalleryAccess() {
  return (
    <GalleryPage title="Acceso a Galería VECA">
      <p>Usa la cuenta de Google habilitada en el panel de VECA.</p>
      <MobileAccess api={galleryApi} />
    </GalleryPage>
  );
}
