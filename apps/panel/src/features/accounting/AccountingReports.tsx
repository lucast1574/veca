import { SireReconciliation } from "./SireReconciliation";
import { useState } from "react";
import type { AccountingPeriod } from "@veca/content";
import { Field } from "../../components/ui";
import {
  accountingPath,
  QueryState,
  Refresh,
  today,
  useAccountingQuery,
} from "./accounting-shared";
import { API_BASE } from "../../lib/api";
import { Summary } from "./AccountingInvoices";

export function TaxPeriod() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const query = useAccountingQuery<AccountingPeriod>(
    month ? accountingPath + "/period/" + month : "",
  );
  const report = query.data;
  return (
    <section>
      <header className="accounting-section-head">
        <h2>Impuestos</h2>
        <div className="accounting-tools">
          <Field label="Periodo">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
          <Refresh loading={query.loading} onClick={query.refresh} />
        </div>
      </header>
      <p className="hint">
        Resumen interno para revisar el periodo con Contabilidad.
      </p>
      <QueryState {...query}>
        {report && (
          <div className="accounting-grid">
            <section className="ops-card">
              <h3>Ventas del periodo</h3>
              <p>
                {report.salesCount}{" "}
                {report.salesCount === 1
                  ? "factura aceptada"
                  : "facturas aceptadas"}
              </p>
              <Summary
                entries={[
                  ["Venta neta", report.salesNet],
                  ["IGV de ventas", report.salesTax],
                ]}
              />
              <a
                className="accounting-inline"
                href={`${API_BASE}${accountingPath}/period/${month}/sales.csv`}
              >
                Descargar ventas
              </a>
            </section>
            <section className="ops-card">
              <h3>Compras y gastos del periodo</h3>
              <p>
                {report.costsCount} registros · {report.pendingCosts} pendientes
                de revisión
              </p>
              <Summary
                entries={[
                  ["Registrado sin IGV", report.costsNet],
                  ["IGV registrado", report.costsTax],
                ]}
              />
              <a
                className="accounting-inline"
                href={`${API_BASE}${accountingPath}/period/${month}/costs.csv`}
              >
                Descargar compras y gastos
              </a>
            </section>
          </div>
        )}
      </QueryState>
      <SireReconciliation month={month} key={month} />
    </section>
  );
}

export { Margin } from "./MarginDashboard";
