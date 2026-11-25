import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import type { AccountingTrends } from "@veca/content";
import {
  amount,
  today,
  useAccountingQuery,
} from "../accounting/accounting-shared";
export type Visuals = {
  workStages: Record<string, number>;
  activity:
    | { period: string; received: number | null; completed: number }[]
    | null;
  stock: Record<string, number> | null;
  publications: Record<string, number> | null;
};
const month = (period: string) =>
  new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" }).format(
    new Date(period + "-01T12:00:00Z"),
  );
export function ActivityChart({
  rows,
}: {
  rows: NonNullable<Visuals["activity"]>;
}) {
  const id = useId(),
    max = Math.max(1, ...rows.flatMap((r) => [r.received || 0, r.completed]));
  return (
    <>
      <svg
        viewBox="0 0 580 200"
        role="img"
        aria-labelledby={id}
        className="dash-bars"
      >
        <title id={id}>
          {rows
            .map(
              (r) =>
                `${month(r.period)}: ${r.received === null ? "" : `${r.received} consultas, `}${r.completed} obras realizadas`,
            )
            .join(". ")}
        </title>
        <line x1="10" x2="570" y1="168" y2="168" className="dash-axis" />
        {rows.map((r, i) => {
          const x = 34 + i * 92;
          return (
            <g key={r.period}>
              {r.received !== null && (
                <>
                  <rect
                    x={x}
                    y={168 - (r.received / max) * 130}
                    width="24"
                    height={(r.received / max) * 130}
                    rx="4"
                    className="dash-fill-neutral"
                  />
                  <text
                    x={x + 12}
                    y={158 - (r.received / max) * 130}
                    textAnchor="middle"
                    className="dash-chart-value"
                  >
                    {r.received}
                  </text>
                </>
              )}
              <rect
                x={x + 30}
                y={168 - (r.completed / max) * 130}
                width="24"
                height={(r.completed / max) * 130}
                rx="4"
                className="dash-fill-brand"
              />
              <text
                x={x + 42}
                y={158 - (r.completed / max) * 130}
                textAnchor="middle"
                className="dash-chart-value"
              >
                {r.completed}
              </text>
              <text
                x={x + 27}
                y="193"
                textAnchor="middle"
                className="dash-chart-label"
              >
                {month(r.period)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="dash-legend">
        {rows[0]?.received !== null && (
          <span>
            <i />
            Consultas recibidas
          </span>
        )}
        <span>
          <i className="is-brand" />
          Obras realizadas
        </span>
      </div>
      <p className="dash-footnote">
        Actividad por mes. Las obras realizadas pueden provenir de consultas de
        meses anteriores.
      </p>
    </>
  );
}
export function Distribution({
  rows,
  label,
}: {
  rows: { label: string; count: number; href: string }[];
  label: string;
}) {
  const id = useId();
  const total = rows.reduce((s, r) => s + r.count, 0);
  let offset = 0;
  return (
    <div className="dash-distribution">
      <div className="dash-donut">
        <svg viewBox="0 0 180 180" role="img" aria-labelledby={id}>
          <title id={id}>
            {rows.map((r) => `${r.label}: ${r.count}`).join(". ")}
          </title>
          <circle cx="90" cy="90" r="65" className="dash-donut-track" />
          {rows.map((r, i) => {
            const n = total ? (r.count / total) * 100 : 0,
              start = offset;
            offset += n;
            return (
              <circle
                key={r.label}
                cx="90"
                cy="90"
                r="65"
                pathLength="100"
                strokeDasharray={`${n} ${100 - n}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
                className={`dash-segment segment-${i}`}
              />
            );
          })}
        </svg>
        <div>
          <strong>{total}</strong>
          <small>{label}</small>
        </div>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={r.label}>
            <a href={r.href}>
              <span className={`dash-dot segment-${i}`} />
              {r.label}
              <b>{r.count}</b>
              <ArrowUpRight size={14} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function DashboardFinance() {
  const query = useAccountingQuery<AccountingTrends>(
    "/admin/accounting/period/" + today().slice(0, 7) + "/overview",
  );
  const rows = query.data?.months.slice(-4) || [],
    max = Math.max(1, ...rows.flatMap((r) => [r.salesNet, r.costsNet]));
  return (
    <section className="dash-panel">
      <header>
        <div>
          <span className="dash-eyebrow">Movimiento económico</span>
          <h2>Ventas y compras registradas</h2>
        </div>
        <a href="#accounting/impuestos" className="warehouse-link">
          Ver detalle <ArrowUpRight size={15} />
        </a>
      </header>
      {query.error ? (
        <p className="hint">
          No pudimos consultar el movimiento económico. Reintenta desde
          Contabilidad.
        </p>
      ) : query.loading && !query.data ? (
        <p className="hint">Cargando importes…</p>
      ) : (
        <div className="dash-finance-bars">
          {rows.map((r) => (
            <div key={r.period}>
              <strong>{month(r.period)}</strong>
              <div className="dash-finance-pair">
                <span style={{ width: `${(r.salesNet / max) * 100}%` }} />
                <b>{amount(r.salesNet)}</b>
              </div>
              <div className="dash-finance-pair is-cost">
                <span style={{ width: `${(r.costsNet / max) * 100}%` }} />
                <b>{amount(r.costsNet)}</b>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="dash-legend">
        <span>
          <i />
          Ventas netas
        </span>
        <span>
          <i className="is-brand" />
          Compras y gastos sin IGV
        </span>
      </div>
      <p className="dash-footnote">
        Importes del periodo para revisión contable. Consulta Margen para
        evaluar la ganancia de cada obra.
      </p>
    </section>
  );
}
