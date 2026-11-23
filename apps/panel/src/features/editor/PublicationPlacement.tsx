import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import {
  LANDING_PROJECT_LIMIT,
  SOLUTION_SLOTS,
  type LandingPlacementId,
  type LandingProjectSelection,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field } from "../../components/ui";

export const landingBlocks = [
  { id: "quote", name: "Cotiza tu instalación" },
  { id: "caseStudy", name: "Obra destacada" },
  { id: "company", name: "Nosotros" },
] as const;
const locations = [...landingBlocks, ...SOLUTION_SLOTS];

export type PublicationPlacement = {
  selection: LandingProjectSelection;
  carousel: number | null;
  slots: LandingPlacementId[];
};

export function PublicationPlacementEditor({
  selection,
  error,
  projectId,
  value,
  onChange,
}: {
  selection?: LandingProjectSelection;
  error: string;
  projectId?: string;
  value?: PublicationPlacement;
  onChange: (value?: PublicationPlacement) => void;
}) {
  const [expanded, setExpanded] = useState(Boolean(value));
  const source = value?.selection ?? selection;
  const currentCarousel =
    source?.items.findIndex(({ id }) => id === projectId) ?? -1;
  const carousel = value?.carousel ?? null;
  const slots = value?.slots ?? [];
  const canAppend = (source?.items.length ?? 0) < LANDING_PROJECT_LIMIT;
  function change(carousel: number | null, slots: LandingPlacementId[]) {
    onChange(
      source && (carousel !== null || slots.length)
        ? { selection: source, carousel, slots }
        : undefined,
    );
  }
  return (
    <section className="publication-placement">
      <header>
        <LayoutGrid size={20} aria-hidden="true" />
        <div>
          <strong>Ubicación en portada</strong>
          <small>
            {value
              ? "Confirma los cambios antes de aplicarlos."
              : "Opcional. Elige dónde mostrar el proyecto."}
          </small>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Ocultar opciones" : "Elegir ubicación"}
        </Button>
      </header>
      {expanded &&
        (source ? (
          <>
            {currentCarousel >= 0 ? (
              <p className="hint">
                Este proyecto ya aparece en la posición {currentCarousel + 1}{" "}
                del carrusel. Puedes ordenarlo desde Gestionar portada.
              </p>
            ) : (
              <Field label="Carrusel">
                <Select
                  label="Posición en el carrusel"
                  value={carousel === null ? "none" : String(carousel)}
                  options={[
                    { value: "none", label: "Conservar el carrusel actual" },
                    ...(canAppend
                      ? [
                          {
                            value: String(source.items.length),
                            label: "Agregar al final",
                          },
                        ]
                      : []),
                    ...source.items.map((item, index) => ({
                      value: String(index),
                      label: `${index + 1}. ${item.title}`,
                      description: item.published
                        ? "Reemplazar esta tarjeta"
                        : "Ocupar la posición del proyecto retirado",
                    })),
                  ]}
                  onChange={(next) =>
                    change(next === "none" ? null : Number(next), slots)
                  }
                />
              </Field>
            )}
            {carousel !== null && source.items[carousel] && (
              <p className="hint">
                Reemplaza a <strong>{source.items[carousel].title}</strong> en
                la tarjeta {carousel + 1}.
              </p>
            )}
            <fieldset>
              <legend>Bloques y soluciones</legend>
              {locations.map(({ id, name }) => {
                const current = source.placements?.[id]?.project;
                const alreadyPlaced = Boolean(
                  projectId && current?.id === projectId && current.published,
                );
                const selected = slots.includes(id);
                return (
                  <label
                    className="publication-placement-choice"
                    key={id}
                    data-chosen={selected}
                  >
                    <input
                      type="checkbox"
                      checked={alreadyPlaced || selected}
                      disabled={alreadyPlaced}
                      onChange={() =>
                        change(
                          carousel,
                          selected
                            ? slots.filter((slot) => slot !== id)
                            : [...slots, id],
                        )
                      }
                    />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {alreadyPlaced
                          ? "Este proyecto ya aparece aquí"
                          : current?.published
                            ? (selected ? "Reemplaza a " : "En portada · ") +
                              current.title
                            : selected
                              ? "Nuevo proyecto en esta ubicación"
                              : "Disponible"}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {Boolean(value) && (
              <p className="hint">Solo cambian las ubicaciones que marques.</p>
            )}
          </>
        ) : (
          <p className="hint" role="status">
            {error || "Consultando la portada publicada…"}
          </p>
        ))}
    </section>
  );
}

export function publicationPlacementInput(
  id: string,
  { selection, carousel, slots }: PublicationPlacement,
) {
  const expectedProjectIds = selection.items.map((item) => item.id);
  const projectIds = [...expectedProjectIds];
  if (carousel !== null) projectIds.splice(carousel, 1, id);
  const placements = Object.fromEntries(
    Object.entries(selection.placements || {}).flatMap(([slot, placement]) =>
      placement.automatic ? [] : [[slot, placement.project?.id ?? null]],
    ),
  );
  const expectedPlacements = Object.fromEntries(
    slots.map((slot) => [
      slot,
      selection.placements?.[slot]?.project?.id ?? null,
    ]),
  );
  for (const slot of slots) placements[slot] = id;
  return {
    projectIds,
    revision: selection.revision,
    placements,
    expectedPlacements,
    expectedProjectIds,
  };
}

export function publicationPlacementSummary(value: PublicationPlacement) {
  const { selection, carousel, slots } = value;
  return [
    ...(carousel === null
      ? []
      : [
          selection.items[carousel]
            ? `Carrusel, tarjeta ${carousel + 1} · reemplaza a ${selection.items[carousel].title}`
            : "Carrusel · nueva tarjeta al final",
        ]),
    ...locations
      .filter(({ id }) => slots.includes(id))
      .map(({ id, name }) => {
        const current = selection.placements?.[id]?.project;
        return current?.published
          ? name + " · reemplaza a " + current.title
          : name;
      }),
  ];
}
