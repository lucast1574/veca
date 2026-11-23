import { SireReconciliation } from "./SireReconciliation";
import { useState } from "react";
import { Select } from "@veca/ui/src/Select";
import type {
  AccountingMargin,
  AccountingPeriod,
  AccountingWork,
} from "@veca/content";
import { Field } from "../../components/ui";
import {
  accountingPath,
  amount,
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

export function Margin() {
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [work, setWork] = useState("");
  const query = useAccountingQuery<AccountingMargin>(
    work ? accountingPath + "/margin/" + work : "",
  );
  const labor = query.data?.labor;
  const complete = labor?.available !== false;
  return (
    <section>
      <header className="accounting-section-head">
        <h2>Margen por obra</h2>
        <div className="accounting-tools">
          <Select
            label="Obra para consultar"
            value={work}
            placeholder="Selecciona una obra"
            options={(works.data || []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={setWork}
          />
          <Refresh
            loading={work ? query.loading : works.loading}
            onClick={work ? query.refresh : works.refresh}
          />
        </div>
      </header>
      <QueryState
        {...works}
        empty={
          !work ? "Selecciona una obra para revisar su resultado." : undefined
        }
      >
        {work && (
          <QueryState {...query}>
            {query.data && (
              <section className="ops-card">
                <h3>{query.data.workName}</h3>
                <Summary
                  entries={[
                    ["Venta neta", query.data.sales],
                    [
                      complete ? "Costos imputados" : "Costos disponibles",
                      query.data.costs,
                    ],
                    ...(complete
                      ? [
                          [
                            "Margen registrado",
                            query.data.sales - query.data.costs,
                          ] as [string, number],
                        ]
                      : []),
                  ]}
                />
                <Summary
                  entries={[
                    ["Cobrado", query.data.paid],
                    ["Por cobrar", query.data.balance],
                  ]}
                />
                <Summary
                  entries={[
                    ["Materiales valorizados", query.data.materialCosts],
                    [
                      "Otros costos",
                      query.data.costs -
                        query.data.materialCosts -
                        (labor?.payroll || 0) -
                        (labor?.fees || 0),
                    ],
                    ...(labor?.available
                      ? ([
                          ["Planilla asignada", labor.payroll],
                          ["Honorarios asignados", labor.fees],
                        ] as [string, number][])
                      : []),
                    ...(query.data.budgetCents && complete
                      ? ([
                          ["Presupuesto de costos", query.data.budgetCents],
                          [
                            "Presupuesto disponible",
                            query.data.budgetCents - query.data.costs,
                          ],
                        ] as [string, number][])
                      : []),
                  ]}
                />
                {!complete && (
                  <p className="hint" role="status">
                    No pudimos cargar los costos de personal asignados. El
                    margen completo estará disponible cuando se puedan consultar
                    en API SUNAT.
                  </p>
                )}
                <a className="accounting-inline" href="#accounting/personal">
                  Gestionar costos de personal
                </a>
                {query.data.pendingValuation && (
                  <p className="hint">
                    Hay consumos con saldo de origen sin costo registrado.
                  </p>
                )}
                {Boolean(query.data.manualMaterialsToReview) && (
                  <p className="hint">
                    {amount(query.data.manualMaterialsToReview)} de consumos
                    manuales del periodo con valorización automática. Revisa si
                    corresponden a los mismos movimientos.
                  </p>
                )}
              </section>
            )}
          </QueryState>
        )}
      </QueryState>
    </section>
  );
}
