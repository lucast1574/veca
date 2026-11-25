import type { WorkQuotation } from "./crm.js";
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
  "meals",
  "services",
  "transport",
  "installation",
  "materials",
  "other",
] as const;
export const COST_KIND_LABELS: Record<(typeof costKinds)[number], string> = {
  purchase: "Materiales para almacén",
  fuel: "Combustible",
  meals: "Comidas y reuniones",
  services: "Servicios",
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
  quotation?: WorkQuotation;
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
  pendingInvoices?: {
    toIssue: number;
    toConfirm: number;
    toCorrect: number;
  };
  sirePurchases?: Pick<
    SirePurchasePage,
    "pending" | "review" | "syncedAt" | "syncFailed" | "syncing"
  >;
};
export type AccountingTrends = {
  months: {
    period: string;
    salesNet: number;
    salesTax: number;
    costsNet: number;
    costsTax: number;
  }[];
  costBreakdown: {
    kind: Exclude<CostInput["kind"], "materials">;
    netCents: number;
  }[];
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
  book?: SireBook;
  period?: string;
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

export const sireIncorporation = z
  .object({
    version: z.number().int().positive(),
    description: z
      .string()
      .trim()
      .min(3, "Escribe brevemente para qué fue la compra.")
      .max(200),
    destination: z.enum(["general", "work", "warehouse"], {
      error: "Selecciona a dónde corresponde esta compra.",
    }),
    kind: z.enum(
      ["fuel", "meals", "services", "transport", "installation", "other"],
      {
        error: "Selecciona el tipo de gasto.",
      },
    ),
    workId: accountingId.optional(),
    allocations: z
      .array(
        z.object({ workId: accountingId, cents: amount.positive() }).strict(),
      )
      .min(1)
      .max(30)
      .optional(),
    purchaseId: accountingId.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      (data.destination === "work") !==
        Boolean(data.workId || data.allocations?.length) ||
      (data.destination !== "warehouse" && Boolean(data.purchaseId)) ||
      Boolean(data.workId && data.allocations?.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Selecciona el destino y su obra o compra de almacén.",
      });
  });
export type SireIncorporation = z.infer<typeof sireIncorporation>;
export type SirePurchase = {
  id: string;
  version: number;
  period: string;
  reference: string;
  taxId: string;
  supplier: string;
  date: string;
  type: string;
  total: number;
  net: number;
  tax: number;
  currency: string;
  importable: boolean;
  reason?: string;
  status: "pending" | "registered" | "different" | "manual";
  costId?: string;
  firstSeenAt?: string;
};
export type SirePurchasePage = {
  items: SirePurchase[];
  total: number;
  pending: number;
  pendingCents: number;
  registered: number;
  review: number;
  hasMore: boolean;
  syncedAt?: string;
  syncFailed?: boolean;
  syncing?: boolean;
  checkedAt?: string;
  newCount?: number;
};

export type ManualCostCheck =
  | { status: "pending" }
  | { status: "found"; purchaseId: string; period: string }
  | { status: "registered"; costId: string }
  | { status: "clear" };
