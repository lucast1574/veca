import { useId, useState } from "react";
import { Check, ChevronDown, House } from "lucide-react";
import {
  LANDING_PROJECT_LIMIT,
  SOLUTION_SLOTS,
  type LandingPlacementId,
  type LandingProjectSelection,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button } from "../../components/ui";

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

const locationGroups = [
  { name: "Bloques de portada", items: landingBlocks },
  { name: "Soluciones", items: SOLUTION_SLOTS },
];

export function PublicationPlacementEditor({
  selection,
  error,
  projectId,
  value,
  onChange,
  onApply,
  initiallyExpanded = false,
}: {
  selection?: LandingProjectSelection;
  error: string;
  projectId?: string;
  value?: PublicationPlacement;
  onChange: (value?: PublicationPlacement) => void;
  onApply?: () => void;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded || Boolean(value));
  const optionsId = useId();
  const source = value?.selection ?? selection;
  const assignedCard =
    source?.items.findIndex(({ id }) => id === projectId) ?? -1;
  const currentCarousel = source?.items[assignedCard]?.published
    ? assignedCard
    : -1;
  const carousel = value?.carousel ?? null;
  const slots = value?.slots ?? [];
  const currentPlaces = locations.filter(({ id }) => {
    const current = source?.placements?.[id]?.project;
    return current?.id === projectId && current?.published;
  });
  const pending = value ? publicationPlacementSummary(value) : [];
  function change(carousel: number | null, slots: LandingPlacementId[]) {
    onChange(
      source && (carousel !== null || slots.length)
        ? { selection: source, carousel, slots }
        : undefined,
    );
  }

  return (
    <section
      id="project-landing-placement"
      className="editor-card publication-placement"
      aria-labelledby="placement-title"
    >
      <header className="placement-heading">
        <span className="placement-symbol">
          <House size={21} aria-hidden="true" />
        </span>
        <div>
          <h3 id="placement-title">Portada del sitio</h3>
          <p>
            Activa los lugares donde quieres mostrar el proyecto al publicar.
          </p>
        </div>
        {source && (
          <button
            type="button"
            className="placement-disclosure"
            aria-expanded={expanded}
            aria-controls={optionsId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Cerrar selección" : "Elegir ubicaciones"}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {source ? (
        <div className="placement-current">
          <span>En portada hoy</span>
          {currentCarousel >= 0 || currentPlaces.length > 0 ? (
            <ul role="list">
              {currentCarousel >= 0 && (
                <li>Carrusel · tarjeta {currentCarousel + 1}</li>
              )}
              {currentPlaces.map(({ id, name }) => (
                <li key={id}>{name}</li>
              ))}
            </ul>
          ) : (
            <p>Este proyecto no ocupa ninguna ubicación.</p>
          )}
        </div>
      ) : (
        <p role="status" className="placement-current">
          {error || "Consultando las ubicaciones de portada…"}
        </p>
      )}

      {source && (
        <div id={optionsId} className="placement-options" hidden={!expanded}>
          <section
            className="placement-carousel"
            aria-labelledby="placement-carousel-title"
          >
            <h4 id="placement-carousel-title">Carrusel de proyectos</h4>
            {assignedCard >= 0 ? (
              <p>
                {currentCarousel >= 0
                  ? `Este proyecto conserva la tarjeta ${assignedCard + 1}.`
                  : `Al publicar, este proyecto recuperará la tarjeta ${assignedCard + 1}.`}{" "}
                Puedes reordenar el carrusel en Gestionar portada.
              </p>
            ) : (
              <Select
                label="Posición en el carrusel"
                value={carousel === null ? "none" : String(carousel)}
                options={[
                  { value: "none", label: "Conservar el carrusel actual" },
                  ...(source.items.length < LANDING_PROJECT_LIMIT
                    ? [
                        {
                          value: String(source.items.length),
                          label: "Agregar al final",
                        },
                      ]
                    : []),
                  ...source.items.map(({ title }, index) => ({
                    value: String(index),
                    label: `Reemplazar tarjeta ${index + 1}`,
                    description: title,
                  })),
                ]}
                onChange={(next) =>
                  change(next === "none" ? null : Number(next), slots)
                }
              />
            )}
            {carousel !== null && source.items[carousel] && (
              <p>
                <strong>Sale del carrusel</strong> ·{" "}
                {source.items[carousel].title}
              </p>
            )}
          </section>

          <div className="placement-location-groups">
            {locationGroups.map(({ name, items }) => (
              <fieldset key={name} className="placement-group">
                <legend>{name}</legend>
                <div className="placement-list">
                  {items.map(({ id, name }) => {
                    const current = source.placements?.[id]?.project;
                    const alreadyPlaced = currentPlaces.some(
                      (item) => item.id === id,
                    );
                    const selected = slots.includes(id);
                    const labelId = `${optionsId}-${id}-name`;
                    const descriptionId = `${optionsId}-${id}-description`;
                    const detail = alreadyPlaced
                      ? "Ya muestra este proyecto"
                      : current?.published
                        ? (selected ? "Reemplazará a " : "Ahora muestra ") +
                          current.title
                        : selected
                          ? "Mostrará este proyecto"
                          : "Ubicación libre";
                    const copy = (
                      <span className="placement-choice-copy">
                        <strong id={labelId}>{name}</strong>
                        <small id={descriptionId}>{detail}</small>
                      </span>
                    );
                    return alreadyPlaced ? (
                      <div className="placement-choice" key={id}>
                        {copy}
                        <Check
                          size={17}
                          className="placement-retained"
                          aria-hidden="true"
                        />
                      </div>
                    ) : (
                      <label
                        className="placement-choice"
                        key={id}
                        data-selected={selected}
                      >
                        {copy}
                        <span className="placement-switch">
                          <input
                            type="checkbox"
                            role="switch"
                            checked={selected}
                            aria-labelledby={labelId}
                            aria-describedby={descriptionId}
                            onChange={(event) =>
                              change(
                                carousel,
                                event.currentTarget.checked
                                  ? [...slots, id]
                                  : slots.filter((slot) => slot !== id),
                              )
                            }
                          />
                          <span
                            className="placement-switch-track"
                            aria-hidden="true"
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="placement-pending">
          <div aria-live="polite">
            <strong>Cambios pendientes en portada</strong>
            <ul>
              {pending.map((description) => (
                <li key={description}>{description}</li>
              ))}
            </ul>
          </div>
          {onApply && (
            <Button type="button" variant="ghost" onClick={onApply}>
              Aplicar ahora en portada
            </Button>
          )}
        </div>
      )}
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
