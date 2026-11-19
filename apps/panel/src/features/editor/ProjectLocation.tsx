import { useState } from "react";
import {
  formatPeruLocation,
  matchPeruLocation,
  PERU_PROJECT_LOCATIONS,
  type PeruLocationRegion,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Field } from "../../components/ui";

const OTHER = "otra";
const REGION_ONLY = "solo-zona";
const regions = [
  ...Object.keys(PERU_PROJECT_LOCATIONS).map((value) => ({
    value,
    label: value,
  })),
  { value: OTHER, label: "Otra ubicación de Perú" },
];

export function ProjectLocation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const match = matchPeruLocation(value);
  const [region, setRegion] = useState<PeruLocationRegion | "" | typeof OTHER>(
    () => match?.region ?? (value ? OTHER : ""),
  );
  const [custom, setCustom] = useState(() => region === OTHER);
  const selectedZone = region && region !== OTHER ? region : null;
  return (
    <div className="project-location">
      <Field
        label="Ubicación del proyecto"
        htmlFor="location-region"
        hint="Perú"
      >
        <Select
          id="location-region"
          label="Ubicación del proyecto"
          value={region}
          options={regions}
          placeholder="Selecciona una zona"
          onChange={(next) => {
            if (next === region) return;
            setRegion(next as PeruLocationRegion | typeof OTHER);
            setCustom(next === OTHER);
            onChange("");
          }}
        />
      </Field>
      {selectedZone && (
        <Field label="Distrito o localidad" htmlFor="location-locality">
          <Select
            id="location-locality"
            label="Distrito o localidad"
            value={
              custom ? OTHER : match?.locality || (value ? REGION_ONLY : "")
            }
            placeholder="Selecciona distrito o localidad"
            options={[
              ...PERU_PROJECT_LOCATIONS[selectedZone].map((locality) => ({
                value: locality,
                label: locality,
              })),
              { value: REGION_ONLY, label: `Solo ${selectedZone}` },
              { value: OTHER, label: "Otra localidad" },
            ]}
            onChange={(next) => {
              if (next === OTHER) {
                if (!custom) onChange("");
                setCustom(true);
                return;
              }
              setCustom(false);
              onChange(
                formatPeruLocation(
                  selectedZone,
                  next === REGION_ONLY ? undefined : next,
                ),
              );
            }}
          />
        </Field>
      )}
      {custom && (
        <Field label="Distrito y departamento" htmlFor="location-custom">
          <input
            id="location-custom"
            maxLength={100}
            placeholder="Ej. San Ramón, Junín"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </Field>
      )}
    </div>
  );
}
