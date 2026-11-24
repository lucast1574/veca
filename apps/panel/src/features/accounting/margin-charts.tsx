import { useId } from "react";
import type { AccountingMargin } from "@veca/content";
import { amount } from "./accounting-shared";
import {
  costCategory,
  marginBridge,
  percentLabel,
  percentage,
} from "./margin-model";

const compactAmount = (cents: number) =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);

export function MarginBridge({
  sales,
  costs,
}: {
  sales: number;
  costs: number;
}) {
  const id = useId();
  const chart = marginBridge(sales, costs);
  return (
    <svg
      className="margin-bridge"
      viewBox="0 0 420 210"
      role="img"
      aria-labelledby={id}
    >
      <title
        id={id}
      >{`Venta neta ${amount(sales)}, menos costos ${amount(costs)}: ${sales < costs ? "pérdida" : "ganancia"} de ${amount(Math.abs(sales - costs))}.`}</title>
      <line
        x1="12"
        x2="408"
        y1={chart.zero}
        y2={chart.zero}
        className="margin-chart-axis"
      />
      {chart.columns.map((column, index) => {
        const x = 30 + index * 140;
        const top = Math.min(chart.y(column.from), chart.y(column.to));
        return (
          <g key={column.label} className={`margin-chart-${column.color}`}>
            {index < 2 && (
              <line
                x1={x + 80}
                x2={x + 140}
                y1={chart.y(index === 0 ? sales : sales - costs)}
                y2={chart.y(index === 0 ? sales : sales - costs)}
                className="margin-chart-connector"
              />
            )}
            <rect
              x={x}
              y={top}
              width="80"
              height={Math.max(
                2,
                Math.abs(chart.y(column.from) - chart.y(column.to)),
              )}
              rx="6"
            />
            <text
              x={x + 40}
              y={top - 12}
              textAnchor="middle"
              className="margin-chart-value"
            >
              {compactAmount(column.value)}
            </text>
            <text
              x={x + 40}
              y="198"
              textAnchor="middle"
              className="margin-chart-label"
            >
              {column.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CostDistribution({
  rows,
  total,
}: {
  rows: AccountingMargin["costBreakdown"];
  total: number;
}) {
  const id = useId();
  const positive = rows.filter((row) => row.cents > 0);
  const base = positive.reduce((sum, row) => sum + row.cents, 0);
  let offset = 0;
  return (
    <div className="margin-distribution">
      <div className="margin-donut">
        <svg viewBox="0 0 200 200" role="img" aria-labelledby={id}>
          <title id={id}>
            {base
              ? positive
                  .map(
                    (row) =>
                      `${costCategory[row.kind].label}: ${amount(row.cents)}`,
                  )
                  .join(". ")
              : "Aún no hay costos registrados."}
          </title>
          <circle
            cx="100"
            cy="100"
            r="78"
            pathLength="100"
            className="margin-donut-track"
          />
          {positive.map((row) => {
            const size = (row.cents / base) * 100;
            const start = offset;
            offset += size;
            return (
              <circle
                key={row.kind}
                cx="100"
                cy="100"
                r="78"
                pathLength="100"
                strokeDasharray={`${size} ${100 - size}`}
                strokeDashoffset={-start}
                className={`margin-cost-${row.kind}`}
                transform="rotate(-90 100 100)"
              />
            );
          })}
        </svg>
        <div>
          <small>Costos {base !== total ? "netos" : "totales"}</small>
          <strong>{amount(total)}</strong>
        </div>
      </div>
      <ol className="margin-cost-list">
        {rows.map((row) => (
          <li key={row.kind}>
            <span
              className={`margin-cost-dot margin-cost-${row.kind}`}
              aria-hidden="true"
            />
            <div>
              <strong>{costCategory[row.kind].label}</strong>
              <small>{costCategory[row.kind].detail}</small>
            </div>
            <div>
              <strong>{amount(row.cents)}</strong>
              <small>
                {row.cents > 0
                  ? percentLabel(percentage(row.cents, base))
                  : "Devolución o ajuste"}
              </small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
