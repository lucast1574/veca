import { useState } from "react";
import {
  formatPeruLocation,
  matchPeruLocation,
  PERU_PROJECT_LOCATIONS,
  type PeruLocationRegion,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { SearchableSelect } from "@veca/ui/src/SearchableSelect";
import { Field } from "../../components/ui";

const LEGACY = "ubicacion-guardada";
const REGION_ONLY = "solo-zona";
const regions = Object.keys(PERU_PROJECT_LOCATIONS).map((value) => ({
  value,
  label: value,
}));

export function ProjectLocation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const match = matchPeruLocation(value);
  const [region, setRegion] = useState<PeruLocationRegion | "" | typeof LEGACY>(
    () => match?.region ?? (value ? LEGACY : ""),
  );
  const selectedZone = region && region !== LEGACY ? region : null;
  const regionOnly = !!match && !match.locality;
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
          options={
            region === LEGACY
              ? [{ value: LEGACY, label: value }, ...regions]
              : regions
          }
          placeholder="Selecciona una zona"
          onChange={(next) => {
            if (next === region) return;
            setRegion(next as PeruLocationRegion);
            onChange("");
          }}
        />
      </Field>
      {selectedZone && (
        <Field label="Distrito o localidad" htmlFor="location-locality">
          <SearchableSelect
            key={selectedZone}
            id="location-locality"
            label="Distrito o localidad"
            value={match?.locality || (regionOnly ? REGION_ONLY : "")}
            placeholder="Selecciona distrito o localidad"
            options={[
              ...PERU_PROJECT_LOCATIONS[selectedZone].map((locality) => ({
                value: locality,
                label: locality,
              })),
              ...(regionOnly
                ? [{ value: REGION_ONLY, label: `Solo ${selectedZone}` }]
                : []),
            ]}
            onChange={(next) => {
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
    </div>
  );
}
