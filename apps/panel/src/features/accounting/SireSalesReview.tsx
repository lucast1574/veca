import { useState } from "react";
import { CloudDownload, FileCheck2, LoaderCircle } from "lucide-react";
import type { AccountingPeriod, SireReconciliation } from "@veca/content";
import { Button } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useAccountingPermission } from "./AccountingAccess";
import { SalesPending } from "./AccountingPeriodPending";
import { SireAutomaticDialog } from "./SireAutomaticDialog";
import { SireFileDialog } from "./SireFileDialog";
import { SireComparisonResult } from "./SireComparisonResult";
import {
  accountingPath,
  QueryState,
  Summary,
  useAccountingQuery,
} from "./accounting-shared";
import "./sire.css";

export function SireSalesReview({
  month,
  refreshing = false,
  onRefresh,
}: {
  month: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const report = useAccountingQuery<AccountingPeriod>(
    `${accountingPath}/period/${month}`,
  );
  const [open, setOpen] = useState<"automatic" | "file" | "result" | null>(
    null,
  );
  const [result, setResult] = useState<SireReconciliation>();
  const busy = refreshing || report.loading;
  function refresh() {
    report.refresh();
    onRefresh?.();
  }
  function done(next: SireReconciliation) {
    setResult(next);
    setOpen("result");
    refresh();
  }
  return (
    <>
      <section
        className="ops-card sire-inbox sire-sales-summary"
        aria-labelledby="sire-sales-title"
      >
        <header className="sire-inbox-header">
          <div>
            <h3 id="sire-sales-title">Ventas del periodo</h3>
            {report.data && !report.error && (
              <p>
                {report.data.salesCount}{" "}
                {report.data.salesCount === 1
                  ? "factura aceptada"
                  : "facturas aceptadas"}
              </p>
            )}
          </div>
          <div className="sire-inbox-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-busy={busy}
              onClick={refresh}
            >
              {busy ? (
                <LoaderCircle size={17} className="sire-refresh-spinner" />
              ) : (
                <CloudDownload size={17} />
              )}
              {busy ? "Actualizando…" : "Actualizar ventas"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!canWrite}
              aria-haspopup="dialog"
              onClick={() => setOpen("automatic")}
            >
              <FileCheck2 size={17} /> Comparar con SUNAT
            </Button>
          </div>
        </header>
        <QueryState {...report}>
          {report.data && !report.error && (
            <>
              <Summary
                entries={[
                  ["Venta neta", report.data.salesNet],
                  ["IGV de ventas", report.data.salesTax],
                  [
                    "Total facturado",
                    report.data.salesNet + report.data.salesTax,
                  ],
                ]}
              />
              <SalesPending report={report.data} />
            </>
          )}
        </QueryState>
      </section>
      {open === "automatic" && (
        <SireAutomaticDialog
          month={month}
          initialBook="sales"
          lockBook
          close={() => setOpen(null)}
          manual={() => setOpen("file")}
          done={done}
        />
      )}
      {open === "file" && (
        <SireFileDialog
          month={month}
          initialBook="sales"
          lockBook
          close={() => setOpen(null)}
          done={done}
        />
      )}
      {open === "result" && result && (
        <Modal
          title={`Comparación de ventas · ${month}`}
          description="Revisa las coincidencias y las facturas que necesitan atención."
          size="wide"
          onClose={() => setOpen(null)}
          footer={
            <footer className="ve-modal-actions">
              <Button type="button" onClick={() => setOpen(null)}>
                Volver a las facturas
              </Button>
            </footer>
          }
        >
          <SireComparisonResult result={result} />
        </Modal>
      )}
    </>
  );
}
