import { z } from "zod";
import { accountingDate, accountingId, accountingMonth } from "./accounting.js";

const revision = z.number().int().nonnegative();
const cents = z.number().int().min(0).max(1_000_000_000);
const health = z.enum(["essalud", "eps", "sis", "special"]);
const pension = z.enum(["onp", "afp", "special"]);
const regime = z.enum([
  "general",
  "micro_remype",
  "small_remype",
  "agrarian",
  "domestic",
  "construction",
  "cas",
  "public",
  "other",
]);
const name = z.string().trim().min(1).max(180);

export const laborRegime = z.object({
  code: regime,
  label: z.string(),
  guidance: z.string(),
  requiresReference: z.boolean(),
  defaultHealthSystem: health,
  healthSystems: z.array(health).min(1),
});

export const employeeInput = z.strictObject({
  name,
  documentType: z.enum(["DNI", "CE"]),
  documentNumber: z.string().trim().min(1).max(15),
  position: z.string().trim().max(120),
  hireDate: accountingDate,
  endDate: accountingDate.optional(),
  salaryCents: cents.positive(),
  pensionSystem: pension,
  laborRegime: regime,
  healthSystem: health,
  regimeReference: z.string().trim().max(240),
  active: z.boolean(),
});
export const laborEmployee = employeeInput
  .extend({ id: z.uuid(), revision, endDate: accountingDate.or(z.literal("")) })
  .strip();
export const payrollLineInput = z.strictObject({
  employeeId: z.uuid(),
  days: z.number().int().min(0).max(30),
  taxableExtraCents: cents,
  nonTaxableCents: cents,
  afpDeductionCents: cents,
  employerContributionCents: cents,
  gratuityCents: cents,
  ctsCents: cents,
  vacationCents: cents,
  fifthCategoryCents: cents,
  otherDeductionCents: cents,
});
const payrollLine = payrollLineInput
  .extend({
    employeeName: z.string(),
    grossCents: cents,
    netCents: cents,
    employerEssaludCents: cents,
  })
  .strip();
export const payrollInput = z.strictObject({
  period: accountingMonth,
  minimumWageCents: cents.positive(),
  lines: z.array(payrollLineInput).min(1).max(500),
});
export const payrollRun = payrollInput
  .extend({
    id: z.uuid(),
    revision,
    status: z.enum(["draft", "approved", "paid", "void"]),
    lines: z.array(payrollLine),
    grossCents: cents,
    deductionCents: cents,
    netCents: cents,
    employerEssaludCents: cents,
    paidAt: z.string().nullable(),
    paymentReference: z.string(),
  })
  .strip();
export const payrollTransition = z.discriminatedUnion("status", [
  z.strictObject({ revision, status: z.enum(["approved", "void"]) }),
  z.strictObject({
    revision,
    status: z.literal("paid"),
    date: accountingDate,
    reference: name,
  }),
]);

const withholding = {
  withholdingAgent: z.boolean(),
  suspensionNumber: z.string().trim().max(100),
  suspensionYear: z.number().int().min(2000).max(2100).nullable(),
};
export const honorariumInput = z.strictObject({
  professionalRuc: z
    .string()
    .trim()
    .regex(/^10\d{9}$/, "Ingresa el RUC de 11 dígitos del profesional."),
  professionalName: name,
  service: z.string().trim().min(1).max(1000),
  issueDate: accountingDate,
  grossCents: cents.positive(),
  ...withholding,
  paymentTerms: z.enum(["cash", "credit"]),
  dueDate: accountingDate.or(z.literal("")),
  series: z.string().trim().toUpperCase().max(4),
  number: z.string().trim().max(8),
  registered: z.boolean(),
  notes: z.string().trim().max(1500),
});
export const honorariumPayment = z.strictObject({
  revision,
  date: accountingDate,
  grossCents: cents.positive(),
  reference: name,
  ...withholding,
});
export const laborReceipt = honorariumInput
  .extend({
    id: z.uuid(),
    revision,
    direction: z.enum(["issued", "received"]),
    status: z.enum(["draft", "registered", "void"]),
    withholdingCents: cents,
    netCents: cents,
    paidCents: cents,
    paidGrossCents: cents,
    withheldPaidCents: cents,
    balanceGrossCents: cents,
    payments: z.array(
      z.object({
        id: z.uuid(),
        date: accountingDate,
        grossCents: cents,
        amountCents: cents,
        withholdingCents: cents,
        reference: z.string(),
      }),
    ),
  })
  .strip();

const sourceId = z.uuid();
export const laborSource = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("payroll"),
    id: sourceId,
    employeeId: sourceId,
  }),
  z.strictObject({ kind: z.literal("fee"), id: sourceId }),
]);
const allocationRows = z
  .array(
    z.strictObject({
      workId: accountingId.transform((value) => value.toLowerCase()),
      basisPoints: z.number().int().min(1).max(10_000),
    }),
  )
  .max(30)
  .refine(
    (rows) =>
      new Set(rows.map((row) => row.workId)).size === rows.length &&
      rows.reduce((total, row) => total + row.basisPoints, 0) <= 10_000,
    "El reparto debe sumar como máximo 100 % y cada obra debe aparecer una sola vez.",
  );
export const laborAllocationInput = z.strictObject({
  source: laborSource,
  sourceRevision: revision,
  revision,
  rows: allocationRows,
});

export type LaborRegime = z.infer<typeof laborRegime>;
export type EmployeeInput = z.infer<typeof employeeInput>;
export type LaborEmployee = z.infer<typeof laborEmployee>;
export type PayrollLineInput = z.infer<typeof payrollLineInput>;
export type PayrollInput = z.infer<typeof payrollInput>;
export type PayrollRun = z.infer<typeof payrollRun>;
export type HonorariumInput = z.infer<typeof honorariumInput>;
export type LaborReceipt = z.infer<typeof laborReceipt>;
export type LaborSource = z.infer<typeof laborSource>;
export type LaborAllocationInput = z.infer<typeof laborAllocationInput>;
export type LaborAllocation = Pick<
  LaborAllocationInput,
  "source" | "revision" | "rows"
>;
export type LaborWorkspace = {
  period: string;
  employees: LaborEmployee[];
  regimes: LaborRegime[];
  runs: PayrollRun[];
  receipts: LaborReceipt[];
  allocations: LaborAllocation[];
};
export type LaborMargin = { payroll: number; fees: number; available: boolean };

export function laborSourceKey(source: LaborSource) {
  return source.kind === "fee"
    ? `fee:${source.id}`
    : `payroll:${source.id}:${source.employeeId}`;
}

export function payrollLineCost(line: PayrollRun["lines"][number]) {
  return line.grossCents + line.employerEssaludCents;
}

export function splitLaborCost(cents: number, rows: LaborAllocation["rows"]) {
  const shares = rows.map(({ workId, basisPoints }) => {
    const weighted = cents * basisPoints;
    return {
      workId,
      cents: Math.floor(weighted / 10_000),
      remainder: weighted % 10_000,
    };
  });
  const target = Math.round(
    (cents * rows.reduce((total, row) => total + row.basisPoints, 0)) / 10_000,
  );
  const leftover =
    target - shares.reduce((total, share) => total + share.cents, 0);
  shares.sort(
    (a, b) => b.remainder - a.remainder || a.workId.localeCompare(b.workId),
  );
  return shares.map(({ workId, cents }, index) => ({
    workId,
    cents: cents + Number(index < leftover),
  }));
}
