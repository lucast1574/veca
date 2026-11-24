import { useAccountingPermission } from "./AccountingAccess";
import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import type { SireBook, SireReconciliation as Result } from "@veca/content";
import { Button } from "../../components/ui";
import { FileInput } from "../../components/FileInput";
import { api } from "../../lib/api";
import { WarehouseForm, WarehouseSelect } from "../warehouse/shared";
import { accountingPath, amount, Pagination } from "./accounting-shared";

const labels = {
  different: "Importe distinto",
  onlySunat: "Solo en SUNAT",
  onlyPanel: "Solo en VECA",
  manual: "Revisión manual",
};
const exportRows = (result: Result) => {
  const escape = (value: string) =>
    '"' +
    (/^\s*[=+@-]/.test(value) ? "'" : "") +
    value.replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "Estado",
        "Comprobante",
        "RUC",
        "Total SUNAT",
        "Total VECA",
        "Moneda",
        "Detalle",
      ],
      ...result.issues.map((issue) => [
        labels[issue.status],
        issue.reference,
        issue.taxId,
        issue.sunat == null ? "" : (issue.sunat / 100).toFixed(2),
        issue.panel == null ? "" : (issue.panel / 100).toFixed(2),
        issue.currency,
        issue.note || "",
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
};

export function SireReconciliation({ month }: { month: string }) {
  const canWrite = useAccountingPermission("accounting_write");
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<SireBook>("purchases");
  const [result, setResult] = useState<Result>();
  const [page, setPage] = useState(1);
  const size = 20;
  return (
    <section className="ops-card warehouse-panel">
      <div className="accounting-section-head">
        <div>
          <h3>Conciliación con SUNAT</h3>
          <p className="hint">
            Compara los comprobantes y sus importes con la propuesta del
            periodo.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={!month || !canWrite}
          onClick={() => setOpen(true)}
        >
          <FileCheck2 size={17} /> Comparar propuesta
        </Button>
      </div>
      {open && (
        <WarehouseForm
          title="Comparar propuesta de SUNAT"
          action="Comparar comprobantes"
          canSubmit={canWrite}
          onClose={() => setOpen(false)}
          save={async (values) => {
            const file = values.get("file");
            if (
              !(file instanceof File) ||
              !/\.txt$/i.test(file.name) ||
              !file.size ||
              file.size > 8_000_000
            )
              throw new Error(
                "Adjunta la propuesta TXT de SUNAT, con contenido y de hasta 8 MB.",
              );
            const form = new FormData();
            form.append("file", file);
            const next = await api<Result>(
              `${accountingPath}/period/${month}/reconcile/${book}`,
              {
                method: "POST",
                body: form,
                signal: AbortSignal.timeout(30_000),
              },
            );
            setResult(next);
            setPage(1);
            setOpen(false);
          }}
        >
          <p className="hint">
            Periodo {month}. Adjunta el TXT original de la propuesta descargada
            de SIRE. Si viene en ZIP, extráelo primero.
          </p>
          <WarehouseSelect
            label="Registro"
            value={book}
            onChange={(value) => setBook(value as SireBook)}
            options={[
              { value: "purchases", label: "Registro de compras (RCE)" },
              { value: "sales", label: "Registro de ventas (RVIE)" },
            ]}
          />
          <FileInput
            label="Archivo de la propuesta (TXT)"
            disabled={!canWrite}
            accept=".txt"
            name="file"
            required
          />
          <div className="warehouse-preview import-instructions">
            <h3>Qué archivo necesitas</h3>
            <ol>
              <li>
                Entra a SIRE de SUNAT con la cuenta de la empresa y elige el
                periodo <strong>{month}</strong>.
              </li>
              <li>
                Descarga la propuesta del Registro de compras (RCE) o de ventas
                (RVIE), según el registro que compararás.
              </li>
              <li>
                Si llega en ZIP, extráelo y adjunta el{" "}
                <strong>TXT original</strong>, separado por barras verticales
                (|). Conserva sus columnas.
              </li>
            </ol>
            <p className="hint">
              Hasta 8 MB y 10 000 comprobantes. El archivo debe corresponder al
              mismo RUC, periodo y registro. Un PDF, Excel o reporte resumido no
              sirve para esta comparación.
            </p>
            <a
              className="warehouse-link"
              href="https://cpe.sunat.gob.pe/node/158"
              target="_blank"
              rel="noreferrer"
            >
              Ver orientación oficial de SIRE
            </a>
          </div>
          <p className="hint">
            Verás coincidencias, importes distintos y comprobantes que aparecen
            solo en SUNAT o solo en VECA. Las facturas en soles se comparan
            automáticamente; otros tipos, monedas o datos incompletos requieren
            revisión manual. Este paso no declara impuestos ni modifica tus
            registros.
          </p>
        </WarehouseForm>
      )}
      {result && (
        <>
          <div className="warehouse-preview">
            <strong>
              {result.matches} coinciden · {result.issues.length} por revisar
            </strong>
            <p>{result.count} comprobantes en la propuesta.</p>
          </div>
          {Boolean(result.issues.length) && (
            <>
              <div className="ops-table-wrap">
                <table className="ops-material-table warehouse-plan-table">
                  <thead>
                    <tr>
                      {["Comprobante", "SUNAT", "VECA", "Resultado"].map(
                        (label) => (
                          <th key={label}>{label}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues
                      .slice((page - 1) * size, page * size)
                      .map((issue, index) => (
                        <tr key={index}>
                          <td>
                            <strong>{issue.reference || "Sin número"}</strong>
                            <small>{issue.taxId}</small>
                          </td>
                          <td>
                            {issue.sunat == null
                              ? "—"
                              : issue.currency === "PEN"
                                ? amount(issue.sunat)
                                : `${issue.currency} ${(issue.sunat / 100).toFixed(2)}`}
                          </td>
                          <td>
                            {issue.panel == null ? "—" : amount(issue.panel)}
                          </td>
                          <td>
                            <strong>{labels[issue.status]}</strong>
                            {issue.note && <small>{issue.note}</small>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                hasMore={page * size < result.issues.length}
                change={setPage}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([exportRows(result)], {
                      type: "text/csv;charset=utf-8",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `conciliacion-${month}.csv`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Descargar diferencias
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
