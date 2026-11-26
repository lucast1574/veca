import { useState } from "react";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  type Material,
} from "@veca/content";
import { Field } from "../../components/ui";
import { post } from "../../lib/api";
import {
  WarehouseForm,
  WarehouseSelect,
  putWarehouse,
  warehousePath,
} from "./shared";
import {
  MaterialDimensionsFields,
  validMaterialDimensions,
  type DraftDimensions,
} from "./MaterialDimensionsFields";

export function MaterialForm({
  close,
  done,
  create = (data) => post<Material>("/admin/crm/materials", data),
}: {
  close: () => void;
  done: (material: Material) => void;
  create?: (data: unknown) => Promise<Material>;
}) {
  const [unit, setUnit] = useState("unit");
  const [category, setCategory] = useState("Vidrio");
  const [dimensions, setDimensions] = useState<DraftDimensions>();
  return (
    <WarehouseForm
      title="Nuevo material"
      action="Crear material"
      onClose={close}
      canSubmit={validMaterialDimensions(dimensions)}
      save={async (form) => {
        const material = await create({
          ...Object.fromEntries(form),
          unit,
          category,
          minimum: Number(form.get("minimum")),
          dimensions,
        });
        done(material);
      }}
    >
      <div className="warehouse-grid">
        {[
          ["name", "Nombre del material"],
          ["sku", "Código / SKU"],
        ].map(([name, label]) => (
          <Field key={name} label={label}>
            <input
              name={name}
              required={name === "sku" || name === "name"}
              maxLength={name === "sku" ? 60 : 160}
              minLength={name === "name" ? 2 : 1}
            />
          </Field>
        ))}
        <WarehouseSelect
          label="Unidad de medida"
          value={unit}
          onChange={setUnit}
          options={MATERIAL_UNITS.map((u) => ({
            value: u.id,
            label: u.id === "unit" ? "Unidad (pieza)" : u.name,
          }))}
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
        <MaterialDimensionsFields
          dimensions={dimensions}
          onChange={setDimensions}
        />
      </div>
      <p className="hint">
        Las medidas son opcionales. Si las indicas, completa la base y la altura
        del material.
      </p>
      <details className="material-extra-details">
        <summary>Más detalles (opcional)</summary>
        <div className="warehouse-grid">
          <Field label="Ubicación en almacén">
            <input name="location" maxLength={200} />
          </Field>
          <Field label="Otra especificación">
            <input name="description" maxLength={1000} />
          </Field>
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
      </details>
      <p className="hint">
        El stock se actualizará cuando Almacén confirme la recepción.
      </p>
    </WarehouseForm>
  );
}

export function EditMaterialDimensions({
  material,
  close,
  done,
}: {
  material: Material;
  close: () => void;
  done: () => void;
}) {
  const [dimensions, setDimensions] = useState<DraftDimensions | undefined>(
    material.dimensions,
  );
  return (
    <WarehouseForm
      title="Editar medidas del material"
      action="Guardar medidas"
      onClose={close}
      canSubmit={validMaterialDimensions(dimensions)}
      save={async () => {
        await putWarehouse(
          `${warehousePath}/materials/${material.id}/dimensions`,
          {
            version: material.version,
            dimensions: dimensions ?? null,
          },
        );
        done();
      }}
    >
      <p className="hint">
        {material.sku} · {material.name}. Si manejas otro tamaño como una pieza
        distinta, usa otro código.
      </p>
      <div className="warehouse-grid">
        <MaterialDimensionsFields
          dimensions={dimensions}
          onChange={setDimensions}
        />
      </div>
    </WarehouseForm>
  );
}
