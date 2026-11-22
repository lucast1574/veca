import type { DemoCaseKey } from "@veca/content";

const alt: Record<DemoCaseKey, string> = {
  mamparas: "Mamparas de vidrio templado en un departamento ficticio",
  fachada: "Fachada de vidrio y panelería interior de un local ficticio",
};

export function DemoPhoto({ demo }: { demo: DemoCaseKey }) {
  return (
    <figure className="demo-photo">
      <img
        src={`/assets/demo/${demo}.webp`}
        alt={alt[demo]}
        width={1000}
        height={667}
        loading="lazy"
      />
      <figcaption>Imagen generada · obra ficticia</figcaption>
    </figure>
  );
}
