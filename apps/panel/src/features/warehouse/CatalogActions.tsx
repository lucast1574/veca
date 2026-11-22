import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  materialSchema,
  type Material,
} from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { amount, unitName } from "../operations/shared";
import { WarehouseForm, postWarehouse, warehousePath } from "./shared";

const header = [
  "codigo",
  "nombre",
  "familia",
  "unidad",
  "ubicacion",
  "descripcion",
  "minimo",
];
const template =
  header.join(",") +
  "\nAGL-18,Tablero aglomerado de 18 mm,Aglomerado,unit,Estante A,Panel 18 mm,3\n";
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

async function readCatalog(file: File) {
  if (file.size > 1_000_000)
    throw new Error("El archivo debe pesar menos de 1 MB.");
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    table = (await readSheet(file, 1)).map((row) =>
      row.map((cell) => (cell == null ? "" : String(cell))),
    );
  } else {
    const { parse } = await import("csv-parse/browser/esm/sync");
    const content = await file.text();
    const delimiter = content.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
    table = parse(content, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  }
  const columns = (table.shift() || []).map(normalize);
  if (
    new Set(columns).size !== columns.length ||
    !["codigo", "nombre", "familia", "unidad"].every((key) =>
      columns.includes(key),
    )
  )
    throw new Error(
      "Usa los encabezados de la plantilla, empezando por código, nombre, familia y unidad.",
    );
  const records = table.filter((row) => row.some((cell) => cell.trim()));
  if (!records.length || records.length > 500)
    throw new Error("Carga de 1 a 500 materiales por archivo.");
  const codes = new Set<string>();
  return records.map((cells, index) => {
    const get = (key: string) => (cells[columns.indexOf(key)] || "").trim();
    const family = MATERIAL_CATEGORIES.find(
      (value) => normalize(value) === normalize(get("familia")),
    );
    const unit = MATERIAL_UNITS.find(
      (value) =>
        normalize(value.name) === normalize(get("unidad")) ||
        value.id === normalize(get("unidad")),
    );
    const parsed = materialSchema.safeParse({
      sku: get("codigo"),
      name: get("nombre"),
      category: family,
      unit: unit?.id,
      location: get("ubicacion"),
      description: get("descripcion"),
      minimum: Number(get("minimo").replace(",", ".")),
    });
    if (!parsed.success)
      throw new Error(
        `Fila ${index + 2}. Revisa el nombre, código, familia, unidad y mínimo.`,
      );
    if (codes.has(parsed.data.sku))
      throw new Error(
        `Fila ${index + 2}. El código ${parsed.data.sku} está repetido.`,
      );
    codes.add(parsed.data.sku);
    return parsed.data;
  });
}

export function CatalogImport({
  close,
  done,
}: {
  close: () => void;
  done: (message: string) => void;
}) {
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof readCatalog>>>();
  const [issue, setIssue] = useState("");
  const [reading, setReading] = useState(false);
  const readingVersion = useRef(0);
  async function inspect(file?: File) {
    const version = ++readingVersion.current;
    setIssue("");
    setPreview(undefined);
    setReading(Boolean(file));
    if (!file) return;
    try {
      const rows = await readCatalog(file);
      if (version === readingVersion.current) setPreview(rows);
    } catch (error) {
      if (version === readingVersion.current)
        setIssue((error as Error).message);
    } finally {
      if (version === readingVersion.current) setReading(false);
    }
  }
  return (
    <WarehouseForm
      title="Importar catálogo"
      action="Confirmar carga"
      onClose={close}
      save={async () => {
        if (!preview || reading)
          throw new Error(
            "Selecciona un archivo válido y revisa la vista previa.",
          );
        const result = await postWarehouse<{
          created: number;
          updated: number;
        }>(warehousePath + "/materials/import", { materials: preview });
        done(`${result.created} creados · ${result.updated} actualizados.`);
      }}
    >
      <p className="hint">
        Sube un Excel (.xlsx) o CSV. Los códigos existentes se actualizan
        conservando su saldo y unidad.
      </p>
      <a
        className="warehouse-link"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent("\uFEFF" + template)}`}
        download="catalogo-veca.csv"
      >
        Descargar plantilla
      </a>
      <Field label="Archivo del catálogo">
        <input
          type="file"
          accept=".csv,.xlsx"
          required
          onChange={(event) => void inspect(event.target.files?.[0])}
        />
      </Field>
      {issue && <Notice error>{issue}</Notice>}
      {reading && <p role="status">Leyendo archivo…</p>}
      {preview && (
        <div className="warehouse-preview">
          <strong>{preview.length} materiales listos para revisar</strong>
          <ul>
            {preview.slice(0, 5).map((row) => (
              <li key={row.sku}>
                {row.sku} · {row.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </WarehouseForm>
  );
}

export function CountStock({
  material,
  close,
  done,
}: {
  material: Material;
  close: () => void;
  done: () => void;
}) {
  const [count, setCount] = useState(String(material.balance));
  const operation = useRef(crypto.randomUUID());
  const difference =
    Math.round((Number(count) - material.balance) * 1000) / 1000;
  return (
    <WarehouseForm
      title="Conciliar conteo físico"
      action="Guardar conteo"
      onClose={close}
      save={async (form) => {
        const unitCost = String(form.get("unitCost") || "");
        await postWarehouse(warehousePath + `/materials/${material.id}/count`, {
          operationId: operation.current,
          version: material.version,
          counted: Number(count),
          reason: form.get("reason"),
          ...(unitCost
            ? { unitCents: Math.round(Number(unitCost) * 100) }
            : {}),
        });
        done();
      }}
    >
      <div className="warehouse-preview">
        <strong>
          {material.sku} · {material.name}
        </strong>
        <p>
          Saldo registrado {amount(material.balance)} {unitName(material.unit)}
        </p>
      </div>
      <div className="warehouse-grid">
        <Field label="Cantidad contada">
          <input
            required
            type="number"
            min="0"
            step="0.001"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
        <Field label="Costo unitario sin IGV (opcional)">
          <input name="unitCost" type="number" min="0" step="0.01" />
        </Field>
      </div>
      <p className="hint">
        Diferencia {difference > 0 ? "+" : ""}
        {amount(difference)} {unitName(material.unit)}. El costo ingresado se
        aplica al saldo sin costo.
      </p>
      <Field label="Motivo del conteo o diferencia">
        <textarea name="reason" required maxLength={500} rows={2} />
      </Field>
    </WarehouseForm>
  );
}

export function ImportCatalogButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick}>
      <FileUp size={16} /> Importar catálogo
    </Button>
  );
}
