import { useState } from "react";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@veca/content";
import { Field } from "../../components/ui";
import { post } from "../../lib/api";
import { WarehouseForm, WarehouseSelect } from "./shared";

export function MaterialForm({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const [unit, setUnit] = useState("unit");
  const [category, setCategory] = useState("Vidrio");
  return (
    <WarehouseForm
      title="Nuevo material"
      action="Crear material"
      onClose={close}
      save={async (form) => {
        await post("/admin/crm/materials", {
          ...Object.fromEntries(form),
          unit,
          category,
          minimum: Number(form.get("minimum")),
        });
        done();
      }}
    >
      <p className="hint">
        Se crea con saldo cero. Registra después la recepción para conservar el
        origen del stock.
      </p>
      <div className="warehouse-grid">
        {[
          ["sku", "Código / SKU"],
          ["name", "Nombre del material"],
          ["location", "Ubicación en almacén"],
          ["description", "Especificación o medida"],
        ].map(([name, label]) => (
          <Field key={name} label={label}>
            <input
              name={name}
              required={name === "sku" || name === "name"}
              maxLength={name === "description" ? 1000 : 160}
            />
          </Field>
        ))}
        <WarehouseSelect
          label="Unidad de medida"
          value={unit}
          onChange={setUnit}
          options={MATERIAL_UNITS.map((u) => ({ value: u.id, label: u.name }))}
        />
        <WarehouseSelect
          label="Familia"
          value={category}
          onChange={setCategory}
          options={MATERIAL_CATEGORIES.map((value) => ({
            value,
            label: value,
          }))}
        />
        <Field label="Saldo mínimo">
          <input
            name="minimum"
            type="number"
            defaultValue="0"
            min="0"
            max="1000000"
            step="0.001"
            required
          />
        </Field>
      </div>
    </WarehouseForm>
  );
}
