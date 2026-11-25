import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import type { AccountingPeriod, SireReconciliation } from "@veca/content";
import { Button, Field } from "../../components/ui";
import { useAccountingPermission } from "./AccountingAccess";
import { SalesPending } from "./AccountingPeriodPending";
import { SireAutomaticDialog } from "./SireAutomaticDialog";
import { SireFileDialog } from "./SireFileDialog";
import { SireClosingGuide } from "./SireClosingGuide";
import { SireComparisonResult } from "./SireComparisonResult";
import {
  accountingPath,
  QueryState,
  Refresh,
  Summary,
  today,
  useAccountingQuery,
} from "./accounting-shared";
import "./sire.css";

export function SireSalesReview({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth || today().slice(0, 7));
  return (
    <>
      <div className="accounting-filters">
        <Field label="Periodo de ventas">
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </Field>
      </div>
      {month && <SalesPeriod month={month} key={month} />}
    </>
  );
}
function SalesPeriod({ month }: { month: string }) {
  const canWrite = useAccountingPermission("accounting_write");
  const report = useAccountingQuery<AccountingPeriod>(
    `${accountingPath}/period/${month}`,
  );
  const [open, setOpen] = useState<"automatic" | "file" | null>(null);
  const [result, setResult] = useState<SireReconciliation>();
  const done = (next: SireReconciliation) => {
    setResult(next);
    setOpen(null);
    report.refresh();
  };
  return (
    <>
      <section
        className="ops-card sire-inbox"
        aria-labelledby="sire-sales-title"
      >
        <header className="sire-inbox-header">
          <div>
            <span className="sire-eyebrow">FACTURAS A TUS CLIENTES</span>
            <h3 id="sire-sales-title">Ventas del periodo</h3>
            <p>
              Revisa las facturas que VECA emite a sus clientes y comprueba que
              coincidan con SUNAT.
            </p>
          </div>
          <div className="sire-inbox-actions">
            <Refresh loading={report.loading} onClick={report.refresh} />
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
              <p className="sire-sales-count">
                {report.data.salesCount} facturas aceptadas
              </p>
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
              <p className="hint">
                Los importes incluyen las facturas aceptadas por SUNAT, también
                las aceptadas con observaciones. Los borradores y envíos por
                confirmar se muestran como pendientes.
              </p>
            </>
          )}
        </QueryState>
        {result && <SireComparisonResult result={result} />}
      </section>
      <SireClosingGuide month={month} book="sales" />
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
    </>
  );
}
