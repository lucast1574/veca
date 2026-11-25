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
import { SireComparisonResult } from "./SireComparisonResult";

export function SireReconciliation({ month }: { month: string }) {
  const canWrite = useAccountingPermission("accounting_write");
  const [open, setOpen] = useState<"automatic" | "file" | "help" | null>(null);
  const [result, setResult] = useState<Result>();
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
        <SireComparisonResult
          key={`${month}:${result.count}:${result.matches}`}
          result={result}
        />
      )}
    </section>
  );
}
