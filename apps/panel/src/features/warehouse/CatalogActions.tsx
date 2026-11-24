import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  materialSchema,
  type Material,
} from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { FileInput } from "../../components/FileInput";
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
const template = header.join(",") + "\r\n";
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

async function readCatalog(file: File) {
  if (!/\.(xlsx|csv)$/i.test(file.name))
    throw new Error(
      "Selecciona un Excel (.xlsx) o un CSV (.csv). Usa la plantilla para conservar las columnas.",
    );
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
  const issues: string[] = [];
  const rows = records.flatMap((cells, index) => {
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
    if (!parsed.success) {
      issues.push(
        `Fila ${index + 2}. Revisa el nombre, código, familia, unidad y mínimo.`,
      );
      return [];
    }
    if (codes.has(parsed.data.sku)) {
      issues.push(
        `Fila ${index + 2}. El código ${parsed.data.sku} está repetido.`,
      );
      return [];
    }
    codes.add(parsed.data.sku);
    return [parsed.data];
  });
  return { rows, issues };
}

export function CatalogImport({
  close,
  done,
}: {
  close: () => void;
  done: (message: string) => void;
}) {
  const [preview, setPreview] = useState<{
    rows: Awaited<ReturnType<typeof readCatalog>>["rows"];
    existing: Map<string, Material | null>;
  }>();
  const [rowIssues, setRowIssues] = useState<string[]>([]);
  const [issue, setIssue] = useState("");
  const [reading, setReading] = useState(false);
  const readingVersion = useRef(0);
  async function inspect(file?: File) {
    const version = ++readingVersion.current;
    setIssue("");
    setRowIssues([]);
    setPreview(undefined);
    setReading(Boolean(file));
    if (!file) return;
    try {
      const { rows, issues } = await readCatalog(file);
      if (version !== readingVersion.current) return;
      setRowIssues(issues);
      if (!rows.length) return;
      const matches = await postWarehouse<
        { sku: string; current: Material | null }[]
      >(warehousePath + "/materials/import/preview", { materials: rows });
      if (version !== readingVersion.current) return;
      const existing = new Map(
        matches.map(({ sku, current }) => [sku, current]),
      );
      const conflicts = rows
        .filter(
          (row) =>
            existing.get(row.sku) && existing.get(row.sku)?.unit !== row.unit,
        )
        .map(
          (row) => `${row.sku}. La unidad debe coincidir con la del catálogo.`,
        );
      setRowIssues([...issues, ...conflicts]);
      setPreview({ rows, existing });
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
      canSubmit={Boolean(preview) && !reading && rowIssues.length === 0}
      onClose={close}
      save={async () => {
        if (!preview || reading || rowIssues.length)
          throw new Error(
            "Selecciona un archivo válido y revisa la vista previa.",
          );
        const result = await postWarehouse<{
          created: number;
          updated: number;
        }>(warehousePath + "/materials/import", { materials: preview.rows });
        done(`${result.created} creados · ${result.updated} actualizados.`);
      }}
    >
      <p className="hint">
        Sube de 1 a 500 materiales en Excel (.xlsx) o CSV, hasta 1 MB. Se lee la
        primera hoja del Excel. Los códigos existentes se actualizan conservando
        su saldo y unidad.
      </p>
      <a
        className="catalog-template"
        href="/templates/catalogo-veca.xlsx"
        download="catalogo-veca.xlsx"
      >
        <img src="/assets/excel.svg" alt="" width="28" height="28" />
        <span>
          <strong>Descargar plantilla de Excel</strong>
          <small>Columnas listas, listas de opciones e instrucciones</small>
        </span>
        <Download size={18} aria-hidden="true" />
      </a>
      <a
        className="warehouse-link"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent("\uFEFF" + template)}`}
        download="catalogo-veca.csv"
      >
        Descargar también en CSV
      </a>
      <FileInput
        label="Archivo del catálogo"
        accept=".csv,.xlsx"
        required
        onChange={(event) => void inspect(event.target.files?.[0])}
      />
      <div className="warehouse-preview import-instructions">
        <h3>Cómo preparar la carga</h3>
        <ol>
          <li>
            Completa la hoja <strong>Catálogo</strong> (o las filas del CSV) con
            un material por fila, desde la fila 2. Mantén los encabezados.
          </li>
          <li>
            Código, nombre, familia y unidad son obligatorios. Ubicación,
            descripción y mínimo son opcionales; el mínimo vacío se considera
            cero.
          </li>
          <li>
            Elige una familia y unidad de las listas de Excel. Usa un código
            único por material y mínimos positivos o cero, con hasta tres
            decimales.
          </li>
          <li>
            Adjunta el archivo y revisa la vista previa. Si hay errores,
            corrígelos antes de confirmar.
          </li>
        </ol>
        <p className="hint">
          La carga registra el catálogo, no existencias. Los materiales nuevos
          empiezan en cero; usa Registrar entrada para ingresar stock. Al
          confirmar verás cuántos se crearon y actualizaron.
        </p>
      </div>

      {issue && <Notice error>{issue}</Notice>}
      {rowIssues.length > 0 && (
        <div role="alert" className="warehouse-preview">
          <strong>Corrige el archivo antes de importar.</strong>
          <ul>
            {rowIssues.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {reading && <p role="status">Leyendo archivo…</p>}
      {preview && (
        <div className="warehouse-preview">
          <strong>
            {preview.rows.length} filas ·{" "}
            {
              preview.rows.filter((row) => !preview.existing.get(row.sku))
                .length
            }{" "}
            nuevas
          </strong>
          <ul>
            {preview.rows.map((row) => {
              const previous = preview.existing.get(row.sku);
              const fields = [
                ["name", "Nombre"],
                ["category", "Familia"],
                ["location", "Ubicación"],
                ["description", "Descripción"],
                ["minimum", "Mínimo"],
                ["unit", "Unidad"],
              ] as const;
              const changes = previous
                ? fields.filter(([key]) => previous[key] !== row[key])
                : [];
              return (
                <li key={row.sku}>
                  <strong>
                    {row.sku} · {row.name}
                  </strong>{" "}
                  {previous
                    ? changes.length
                      ? "Actualizar"
                      : "Sin cambios de datos"
                    : "Crear"}
                  {previous && changes.length > 0 && (
                    <ul>
                      {changes.map(([key, label]) => (
                        <li key={key}>
                          {label} ·{" "}
                          {String(
                            previous[key] === "" ? "Sin valor" : previous[key],
                          )}{" "}
                          → {String(row[key] === "" ? "Sin valor" : row[key])}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!previous && (
                    <p>
                      {row.category} · {unitName(row.unit)} · Mínimo{" "}
                      {amount(row.minimum)}
                      {row.location && ` · ${row.location}`}
                    </p>
                  )}
                </li>
              );
            })}
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
