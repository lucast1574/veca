import { useAccountingPermission } from "./AccountingAccess";
import { useState } from "react";
import { ArrowRight, FileCheck2, Info } from "lucide-react";
import type { SireReconciliation as Result } from "@veca/content";
import { Button } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { SireAutomaticDialog } from "./SireAutomaticDialog";
import { SireFileDialog } from "./SireFileDialog";
import "./sire.css";
import { SireClosingGuide } from "./SireClosingGuide";
import { amount, Pagination } from "./accounting-shared";

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
  const [open, setOpen] = useState<"automatic" | "file" | "help" | null>(null);
  const [result, setResult] = useState<Result>();
  const [page, setPage] = useState(1);
  const size = 20;
  return (
    <section className="ops-card warehouse-panel">
      <div className="accounting-section-head">
        <div>
          <div className="sire-section-title">
            <h3>Compras y ventas en SUNAT</h3>
            <button
              type="button"
              className="ops-icon-button"
              aria-label="Cómo funciona la conciliación con SUNAT"
              aria-haspopup="dialog"
              onClick={() => setOpen("help")}
            >
              <Info size={17} aria-hidden="true" />
            </button>
          </div>
          <p className="hint">
            Las compras llegan a su bandeja. Las ventas se comparan con tus
            facturas emitidas.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={!month || !canWrite}
          onClick={() => setOpen("automatic")}
        >
          <FileCheck2 size={17} /> Revisar ventas
        </Button>
      </div>
      {open === "help" && (
        <Modal
          title="¿Qué revisa esta comparación?"
          onClose={() => setOpen(null)}
          footer={
            <footer className="ve-modal-actions">
              <Button type="button" onClick={() => setOpen(null)}>
                Entendido
              </Button>
            </footer>
          }
        >
          <div className="sire-help-copy">
            <p>
              Las compras son facturas de tus proveedores. Se descargan
              automáticamente y quedan por completar en Compras y gastos. Las
              ventas son las facturas que VECA emite a sus clientes.
            </p>
            <ul>
              <li>Identifica los comprobantes que coinciden.</li>
              <li>Señala los que aparecen solo en VECA o solo en SUNAT.</li>
              <li>Destaca importes distintos y datos por revisar.</li>
            </ul>
            <p className="sire-help-note">
              Guardar una compra en VECA y presentar el registro mensual en
              SUNAT son pasos distintos. La presentación se completa en SOL.
            </p>
          </div>
        </Modal>
      )}
      {open === "automatic" && (
        <SireAutomaticDialog
          month={month}
          initialBook="sales"
          lockBook
          close={() => setOpen(null)}
          manual={() => setOpen("file")}
          done={(result) => {
            setResult(result);
            setPage(1);
            setOpen(null);
          }}
        />
      )}
      {open === "file" && (
        <SireFileDialog
          month={month}
          close={() => setOpen(null)}
          done={(result) => {
            setResult(result);
            setPage(1);
            setOpen(null);
          }}
        />
      )}
      <div className="sire-next-step">
        <div>
          <strong>¿Buscas las compras de tus proveedores?</strong>
          <p>
            Están en Compras por registrar. Allí puedes completarlas y
            guardarlas sin escribir otra vez la factura.
          </p>
        </div>
        <a className="accounting-inline" href="#accounting/gastos">
          Ir a las compras <ArrowRight size={15} />
        </a>
      </div>
      <SireClosingGuide month={month} />
      {result && result.book === "purchases" && (
        <div className="sire-query-status" role="status">
          <Info size={20} />
          <div>
            <strong>Compras consultadas · {month}</strong>
            <p>
              {result.count} comprobantes revisados. Los nuevos quedaron en
              Compras por registrar.{" "}
              <a href="#accounting/gastos">Abrir la bandeja de compras</a>
            </p>
          </div>
        </div>
      )}
      {result && result.book !== "purchases" && (
        <>
          <div className="warehouse-preview">
            <strong>
              Ventas · {month} · {result.matches} coinciden ·{" "}
              {result.issues.length} por revisar
            </strong>
            <p>
              {result.count
                ? `${result.count} facturas de venta encontradas en SUNAT.`
                : "SUNAT no encontró ventas en este mes. Si aún no has emitido facturas, no tienes nada que revisar aquí."}
            </p>
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
