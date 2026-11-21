import type { ReactNode } from "react";
import "./gallery-page.css";

export function GalleryPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main id="contenido" className="ve-gallery-page">
      <a className="ve-gallery-brand" href="/">
        <img
          src="/assets/logo.svg"
          alt="Vidrios VECA, inicio"
          width="96"
          height="62"
        />
      </a>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
