import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import type { AccountingPeriod } from "@veca/content";
import { Field } from "../../components/ui";
import {
  accountingPath,
  QueryState,
  Refresh,
  Summary,
  today,
  useAccountingQuery,
} from "./accounting-shared";
import { API_BASE } from "../../lib/api";
import { PurchasesPending, SalesPending } from "./AccountingPeriodPending";
import { TaxPeriodCharts } from "./TaxPeriodCharts";
import "./sire.css";

export function TaxPeriod({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth || today().slice(0, 7));
  const query = useAccountingQuery<AccountingPeriod>(
    month ? accountingPath + "/period/" + month : "",
  );
  const [revision, setRevision] = useState(0);
  const refreshAll = useCallback(() => {
    query.refresh();
    setRevision((value) => value + 1);
  }, [query.refresh]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshAll]);
  const report = query.data;
  return (
    <section aria-labelledby="accounting-taxes">
      <header className="accounting-section-head">
        <div>
          <h2 id="accounting-taxes">Impuestos</h2>
          <p className="hint">
            Revisa los importes y pendientes del mes. Completa cada registro en
            su sección.
          </p>
        </div>
        <div className="accounting-tools">
          <Field label="Periodo">
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
          <Refresh loading={query.loading} onClick={refreshAll} />
        </div>
      </header>
      <QueryState {...query}>
        {report && !query.error && (
          <div className="accounting-grid accounting-tax-cards">
            <section className="ops-card" aria-labelledby="tax-sales-title">
              <div className="accounting-tax-heading">
                <span className="sire-eyebrow">FACTURAS A TUS CLIENTES</span>
                <h3 id="tax-sales-title">Ventas del periodo</h3>
                <p>
                  {report.salesCount}{" "}
                  {report.salesCount === 1
                    ? "factura aceptada"
                    : "facturas aceptadas"}
                </p>
              </div>
              <Summary
                entries={[
                  ["Venta neta", report.salesNet],
                  ["IGV de ventas", report.salesTax],
                ]}
              />
              <SalesPending report={report} />
              <p className="hint">
                Las ventas se suman cuando SUNAT acepta la factura. Los
                borradores y envíos sin confirmar quedan como pendientes.
              </p>
              <footer className="accounting-tax-actions">
                <a
                  className="accounting-inline"
                  href={`#accounting/facturas/sunat?month=${month}`}
                >
                  Ver ventas y facturas <ArrowRight size={15} />
                </a>
                <a
                  className="accounting-tax-download"
                  href={`${API_BASE}${accountingPath}/period/${month}/sales.csv`}
                >
                  <ArrowDownToLine size={15} /> Descargar ventas
                </a>
              </footer>
            </section>
            <section className="ops-card" aria-labelledby="tax-purchases-title">
              <div className="accounting-tax-heading">
                <span className="sire-eyebrow">COMPRAS A TUS PROVEEDORES</span>
                <h3 id="tax-purchases-title">Compras y gastos del periodo</h3>
                <p>
                  {report.costsCount}{" "}
                  {report.costsCount === 1
                    ? "registro guardado"
                    : "registros guardados"}
                </p>
              </div>
              <Summary
                entries={[
                  ["Registrado sin IGV", report.costsNet],
                  ["IGV registrado", report.costsTax],
                ]}
              />
              <PurchasesPending report={report} />
              <p className="hint">
                Las compras de SUNAT se suman después de completarlas y
                guardarlas en VECA. Cada comprobante se cuenta una vez.
              </p>
              <footer className="accounting-tax-actions">
                <a
                  className="accounting-inline"
                  href={`#accounting/gastos?month=${month}`}
                >
                  Ver compras y gastos <ArrowRight size={15} />
                </a>
                <a
                  className="accounting-tax-download"
                  href={`${API_BASE}${accountingPath}/period/${month}/costs.csv`}
                >
                  <ArrowDownToLine size={15} /> Descargar compras
                </a>
              </footer>
            </section>
          </div>
        )}
      </QueryState>
      {month && <TaxPeriodCharts month={month} revision={revision} />}
    </section>
  );
}
export { Margin } from "./MarginDashboard";
