import type { AccountingMargin } from "@veca/content";

export const costCategory = {
  materials: {
    label: "Materiales",
    detail: "Consumos de almacén y registros internos",
    color: "materials",
  },
  payroll: {
    label: "Planilla",
    detail: "Personal asignado a la obra",
    color: "payroll",
  },
  fees: {
    label: "Honorarios",
    detail: "Servicios profesionales asignados",
    color: "fees",
  },
  installation: {
    label: "Instalación",
    detail: "Servicios de instalación registrados",
    color: "installation",
  },
  transport: {
    label: "Transporte",
    detail: "Traslados y fletes",
    color: "transport",
  },
  fuel: { label: "Combustible", detail: "Movilidad y equipos", color: "fuel" },
  meals: {
    label: "Comidas y reuniones",
    detail: "Atención y reuniones asignadas a la obra",
    color: "other",
  },
  services: {
    label: "Servicios",
    detail: "Servicios contratados para la obra",
    color: "installation",
  },
  other: {
    label: "Otros gastos",
    detail: "Otros costos asignados a esta obra",
    color: "other",
  },
} as const;

export const percentage = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : null;
export const percentLabel = (value: number | null) =>
  value === null
    ? "Sin venta registrada"
    : `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(value)} %`;
export const progress = (value: number, total: number) =>
  Math.max(0, Math.min(100, percentage(value, total) ?? 0));

export function marginBreakdown(report: AccountingMargin) {
  // Keep the view usable during a rolling deployment with an older API.
  const source = report.costBreakdown ?? [
    { kind: "materials" as const, cents: report.materialCosts },
    { kind: "payroll" as const, cents: report.labor.payroll },
    { kind: "fees" as const, cents: report.labor.fees },
    {
      kind: "other" as const,
      cents:
        report.costs -
        report.materialCosts -
        report.labor.payroll -
        report.labor.fees,
    },
  ];
  return source
    .filter((row) => row.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
}

export function marginBridge(sales: number, costs: number) {
  const result = sales - costs;
  const low = Math.min(0, result, sales, costs);
  const high = Math.max(1, sales, costs, result);
  const y = (value: number) => 162 - ((value - low) / (high - low)) * 120;
  return {
    y,
    zero: y(0),
    columns: [
      { label: "Venta neta", value: sales, from: 0, to: sales, color: "sales" },
      {
        label: "Costos",
        value: costs,
        from: result,
        to: sales,
        color: "costs",
      },
      {
        label: result < 0 ? "Pérdida" : "Ganancia",
        value: result,
        from: 0,
        to: result,
        color: result < 0 ? "loss" : "profit",
      },
    ],
  };
}
