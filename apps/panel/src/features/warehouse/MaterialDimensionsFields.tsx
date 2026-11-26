import {
  materialDimensionsSchema,
  type MaterialDimensions,
} from "@veca/content";
import { useState } from "react";
import { Field } from "../../components/ui";
import { WarehouseSelect } from "./shared";
import "./material-dimensions.css";

export type DraftDimensions = Partial<MaterialDimensions>;
const fields = [
  ["baseMm", "Base"],
  ["heightMm", "Altura"],
] as const;
const units = [
  { value: "mm", label: "Milímetros (mm)", millimeters: 1 },
  { value: "cm", label: "Centímetros (cm)", millimeters: 10 },
  { value: "m", label: "Metros (m)", millimeters: 1000 },
] as const;

// Remove binary floating-point noise without rounding to the stored increment.
const decimal = (value: number) => Number(value.toPrecision(15));

export function validMaterialDimensions(dimensions?: DraftDimensions) {
  return (
    dimensions === undefined ||
    materialDimensionsSchema.safeParse(dimensions).success
  );
}

export function MaterialDimensionsFields({
  dimensions,
  onChange,
}: {
  dimensions?: DraftDimensions;
  onChange: (value: DraftDimensions | undefined) => void;
}) {
  const [unit, setUnit] = useState<(typeof units)[number]>(units[0]);
  const scale = unit.millimeters;
  const increment = 0.001 / scale;
  return (
    <div className="material-dimensions-fields">
      <WarehouseSelect
        label="Unidad de las medidas"
        value={unit.value}
        options={units}
        onChange={(value) => {
          const selected = units.find((item) => item.value === value);
          if (selected) setUnit(selected);
        }}
      />
      {fields.map(([key, label]) => {
        const measure = dimensions?.[key];
        return (
          <Field label={`${label} (${unit.value})`} key={key}>
            <input
              type="number"
              min={increment}
              max={1_000_000 / scale}
              step={increment}
              value={measure === undefined ? "" : decimal(measure / scale)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                const next = {
                  ...dimensions,
                  [key]:
                    value === "" ? undefined : decimal(Number(value) * scale),
                };
                onChange(
                  next.baseMm === undefined && next.heightMm === undefined
                    ? undefined
                    : next,
                );
              }}
            />
          </Field>
        );
      })}
    </div>
  );
}
