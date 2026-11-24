import type { LaborMargin } from "./labor.js";
import { z } from "zod";

const text = (length: number) => z.string().trim().min(1).max(length);
const amount = z.number().int().nonnegative().max(999_999_999);
export const accountingDate = z.iso.date();
export const accountingMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const accountingId = z.string().regex(/^[0-9a-f]{24}$/i);
const workId = accountingId.or(z.literal(""));

export const invoiceInput = z
  .object({
    workId: workId.default(""),
    customer: text(150),
    customerRuc: z.string().regex(/^\d{11}$/, "Ingresa un RUC de 11 dígitos."),
    method: z.enum(["cash", "credit"]),
    dueDate: accountingDate.or(z.literal("")).default(""),
    items: z
      .array(
        z
          .object({
            description: text(250),
            quantityMilli: z.number().int().positive().max(1_000_000),
            unitCents: amount.positive(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine((data) => data.method !== "credit" || Boolean(data.dueDate), {
    message: "Indica la fecha de vencimiento.",
  });
export type InvoiceInput = z.infer<typeof invoiceInput>;
export type InvoiceStatus =
  | "requested"
  | "draft"
  | "sending"
  | "pending"
  | "accepted"
  | "observed"
  | "rejected";
export type AccountingInvoice = InvoiceInput & {
  id: string;
  workName: string;
  version: number;
  status: InvoiceStatus;
  createdAt: string;
  issueDate: string;
  number: string;
  observation: string;
  canCheck: boolean;
  netCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  payments: { date: string; cents: number; reference: string }[];
};
export const invoicePayment = z
  .object({
    version: z.number().int().positive(),
    date: accountingDate,
    cents: amount.positive(),
    reference: z.string().trim().max(120).default(""),
  })
  .strict();

export const costKinds = [
  "purchase",
  "fuel",
  "transport",
  "installation",
  "materials",
  "other",
] as const;
export const COST_KIND_LABELS: Record<(typeof costKinds)[number], string> = {
  purchase: "Compra",
  fuel: "Combustible",
  transport: "Transporte",
  installation: "Instalación",
  materials: "Consumo de materiales",
  other: "Otro gasto",
};
export const costInput = z
  .object({
    description: text(200),
    kind: z.enum(costKinds),
    date: accountingDate,
    supplier: z.string().trim().max(150).default(""),
    supplierRuc: z
      .string()
      .regex(/^\d{11}$/)
      .or(z.literal(""))
      .default(""),
    reference: z.string().trim().max(80).default(""),
    purchaseId: accountingId.optional(),
    dispatchId: accountingId.optional(),
    netCents: amount.positive(),
    taxCents: amount,
    allocations: z
      .array(
        z.object({ workId: accountingId, cents: amount.positive() }).strict(),
      )
      .max(30),
  })
  .strict()
  .refine(
    ({ allocations, netCents }) =>
      new Set(allocations.map((row) => row.workId.toLowerCase())).size ===
        allocations.length &&
      (!allocations.length ||
        allocations.reduce((sum, row) => sum + row.cents, 0) === netCents),
    {
      message:
        "Distribuye todo el importe neto entre obras distintas o deja el gasto como general.",
    },
  )
  .refine(
    ({ kind, taxCents, allocations }) =>
      kind !== "materials" || (!taxCents && !!allocations.length),
    {
      message:
        "Asigna el consumo a una obra. El registro de costo interno no lleva IGV.",
    },
  );
export type CostInput = z.infer<typeof costInput>;
export type AccountingCost = CostInput & {
  id: string;
  version: number;
  proof: boolean;
  reviewed: boolean;
};

export type AccountingWork = { id: string; name: string };
export type AccountingMargin = {
  workId: string;
  workName: string;
  sales: number;
  costs: number;
  paid: number;
  balance: number;
  costCount: number;
  materialCosts: number;
  costBreakdown: {
    kind: Exclude<CostInput["kind"], "purchase"> | "payroll" | "fees";
    cents: number;
  }[];
  labor: LaborMargin;
  budgetCents: number;
  pendingValuation: boolean;
  manualMaterialsToReview: number;
};
export type AccountingPeriod = {
  salesNet: number;
  salesTax: number;
  salesCount: number;
  costsNet: number;
  costsTax: number;
  costsCount: number;
  pendingCosts: number;
};
export const accountingTotals = (items: InvoiceInput["items"]) => {
  const bases = items.map((item) =>
    Math.round((item.unitCents * item.quantityMilli) / 1000),
  );
  const netCents = bases.reduce((sum, base) => sum + base, 0);
  const taxCents = bases.reduce(
    (sum, base) => sum + Math.round((base * 18) / 100),
    0,
  );
  return { netCents, taxCents, totalCents: netCents + taxCents };
};

export type SireBook = "purchases" | "sales";
export type SireReconciliation = {
  count: number;
  matches: number;
  issues: {
    status: "different" | "onlySunat" | "onlyPanel" | "manual";
    reference: string;
    taxId: string;
    sunat?: number;
    panel?: number;
    currency: string;
    note?: string;
  }[];
};
export type SireComparison = {
  job: string;
  status: "pending" | "ready";
  result?: SireReconciliation;
};
