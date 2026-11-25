import { useId } from "react";
import { COST_KIND_LABELS, type AccountingTrends } from "@veca/content";
import {
  accountingPath,
  amount,
  QueryState,
  today,
  useAccountingQuery,
} from "./accounting-shared";
import "./tax-charts.css";

type Month = AccountingTrends["months"][number];
const monthLabel = (period: string, full = false) =>
  new Intl.DateTimeFormat("es-PE", {
    month: full ? "long" : "short",
    year: full ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${period}-01T12:00:00Z`));
const compact = (cents: number) =>
  new Intl.NumberFormat("es-PE", {
    notation: "compact",
    maximumFractionDigits: cents < 100 ? 2 : 1,
  }).format(cents / 100);
function change(current: number, previous: number) {
  if (!previous) return current ? "Sin base anterior" : "Sin movimientos";
  const percent = ((current - previous) / previous) * 100;
  return `${percent > 0 ? "+" : ""}${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(percent)} %`;
}

export function TaxPeriodCharts({
  month,
  revision,
}: {
  month: string;
  revision?: number;
}) {
  const query = useAccountingQuery<AccountingTrends>(
    `${accountingPath}/period/${month}/overview${revision ? `?revision=${revision}` : ""}`,
  );
  return (
    <div className="tax-charts">
      <QueryState {...query}>
        {query.data && !query.error && (
          <>
            <MonthlyChart months={query.data.months} />
            <ExpenseChart rows={query.data.costBreakdown} />
          </>
        )}
      </QueryState>
    </div>
  );
}
function MonthlyChart({ months }: { months: Month[] }) {
  const current = months.at(-1),
    previous = months.at(-2);
  const maximum = Math.max(
    1,
    ...months.flatMap((row) => [row.salesNet, row.costsNet]),
  );
  const hasData = months.some((row) => row.salesNet || row.costsNet);
  return (
    <section className="ops-card tax-chart-card">
      <div className="tax-chart-heading">
        <h3>Ventas y compras por mes</h3>
        <p>Últimos 6 meses · Importes sin IGV guardados en VECA.</p>
      </div>
      {current && previous && (
        <dl className="tax-month-changes">
          <div>
            <dt>Ventas frente a {monthLabel(previous.period)}</dt>
            <dd>{change(current.salesNet, previous.salesNet)}</dd>
          </div>
          <div>
            <dt>Compras frente a {monthLabel(previous.period)}</dt>
            <dd>{change(current.costsNet, previous.costsNet)}</dd>
          </div>
        </dl>
      )}
      <div className="tax-chart-legend">
        <span>
          <i className="tax-sales-color" /> Ventas aceptadas
        </span>
        <span>
          <i className="tax-costs-color" /> Compras y gastos
        </span>
      </div>
      <div
        className="tax-month-chart"
        role="img"
        aria-label={months
          .map(
            (row) =>
              `${monthLabel(row.period, true)}: ventas ${amount(row.salesNet)}, compras y gastos ${amount(row.costsNet)}`,
          )
          .join(". ")}
      >
        <div className="tax-chart-axis" aria-hidden="true">
          <span>{compact(hasData ? maximum : 0)}</span>
          <span>{compact(hasData ? maximum / 2 : 0)}</span>
          <span>0</span>
        </div>
        <div className="tax-month-plot" aria-hidden="true">
          <div className="tax-chart-lines">
            <span />
            <span />
            <span />
          </div>
          {months.map((row) => (
            <div className="tax-month-column" key={row.period}>
              <div
                className="tax-month-bars"
                title={`${monthLabel(row.period, true)} · Ventas ${amount(row.salesNet)} · Compras ${amount(row.costsNet)}`}
              >
                <span
                  className="tax-month-bar tax-sales-color"
                  style={{ height: `${(row.salesNet / maximum) * 100}%` }}
                />
                <span
                  className="tax-month-bar tax-costs-color"
                  style={{ height: `${(row.costsNet / maximum) * 100}%` }}
                />
              </div>
              <span className="tax-month-label">{monthLabel(row.period)}</span>
            </div>
          ))}
        </div>
      </div>
      {!hasData && (
        <p className="hint">
          Todavía no hay ventas aceptadas ni compras guardadas en estos meses.
        </p>
      )}
      {current?.period === today().slice(0, 7) && (
        <p className="hint">El mes en curso sigue sumando movimientos.</p>
      )}
      <details className="tax-chart-data">
        <summary>Ver importes por mes</summary>
        <div className="ops-table-wrap">
          <table className="ops-material-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Ventas sin IGV</th>
                <th>Compras sin IGV</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.period}>
                  <td>{monthLabel(row.period, true)}</td>
                  <td>{amount(row.salesNet)}</td>
                  <td>{amount(row.costsNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function ExpenseChart({ rows }: { rows: AccountingTrends["costBreakdown"] }) {
  const title = useId();
  const positive = rows.filter((row) => row.netCents > 0);
  const total = positive.reduce((sum, row) => sum + row.netCents, 0);
  let offset = 0;
  return (
    <section className="ops-card tax-chart-card">
      <div className="tax-chart-heading">
        <h3>¿En qué se compró o gastó?</h3>
        <p>Distribución del mes elegido · Sin IGV.</p>
      </div>
      <div className="tax-expense-distribution">
        <div className="tax-expense-donut">
          <svg viewBox="0 0 200 200" role="img" aria-labelledby={title}>
            <title id={title}>
              {positive.length
                ? positive
                    .map(
                      (row) =>
                        `${COST_KIND_LABELS[row.kind]}: ${amount(row.netCents)}`,
                    )
                    .join(". ")
                : "Sin compras ni gastos guardados en este mes."}
            </title>
            <circle
              className="tax-donut-track"
              cx="100"
              cy="100"
              r="78"
              pathLength="100"
            />
            {positive.map((row) => {
              const size = (row.netCents / total) * 100,
                start = offset;
              offset += size;
              return (
                <circle
                  key={row.kind}
                  className={`tax-cost-${row.kind}`}
                  cx="100"
                  cy="100"
                  r="78"
                  pathLength="100"
                  strokeDasharray={`${size} ${100 - size}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 100 100)"
                />
              );
            })}
          </svg>
          <div>
            <span>Compras y gastos</span>
            <strong>{amount(total)}</strong>
          </div>
        </div>
        {positive.length ? (
          <ol className="tax-expense-legend">
            {positive.map((row) => (
              <li key={row.kind}>
                <i className={`tax-cost-${row.kind}`} aria-hidden="true" />
                <div>
                  <strong>{COST_KIND_LABELS[row.kind]}</strong>
                  <span>{amount(row.netCents)}</span>
                </div>
                <small>
                  {new Intl.NumberFormat("es-PE", {
                    maximumFractionDigits: 1,
                  }).format((row.netCents / total) * 100)}{" "}
                  %
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">
            El gráfico aparecerá al guardar compras y gastos. Las facturas de
            SUNAT por completar aún no se suman.
          </p>
        )}
      </div>
    </section>
  );
}
