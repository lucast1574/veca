import {
  materialDimensionsSchema,
  type MaterialDimensions,
} from "@veca/content";
import type { ChangeEvent } from "react";
import { Field } from "../../components/ui";

export type DraftDimensions = Partial<MaterialDimensions>;
const fields = [
  ["baseMm", "Base (mm)"],
  ["heightMm", "Altura (mm)"],
] as const;

export function readMaterialDimensions(form: FormData) {
  const base = String(form.get("baseMm") ?? "").trim();
  const height = String(form.get("heightMm") ?? "").trim();
  return base || height
    ? { baseMm: Number(base), heightMm: Number(height) }
    : undefined;
}

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
  onChange?: (value: DraftDimensions | undefined) => void;
}) {
  return fields.map(([key, label]) => (
    <Field label={label} key={key}>
      <input
        type="number"
        min="0.001"
        max="1000000"
        step="0.001"
        {...(onChange
          ? {
              value: dimensions?.[key] ?? "",
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                const value = event.currentTarget.value;
                const next = {
                  ...dimensions,
                  [key]: value ? Number(value) : undefined,
                };
                onChange(
                  next.baseMm === undefined && next.heightMm === undefined
                    ? undefined
                    : next,
                );
              },
            }
          : { name: key, defaultValue: dimensions?.[key] })}
      />
    </Field>
  ));
}
