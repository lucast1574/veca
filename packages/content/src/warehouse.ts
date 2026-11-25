import { z } from "zod";
import { quantitySchema, materialSchema } from "./crm.js";
import { accountingId } from "./accounting.js";

const detail = (max: number) => z.string().trim().min(1).max(max);
export const recordRevision = z.number().int().positive();
export const inventoryImport = z
  .object({
    materials: z.array(materialSchema).min(1).max(500),
  })
  .strict();
export const stockCount = z
  .object({
    operationId: z.uuid(),
    version: recordRevision,
    counted: quantitySchema.or(z.literal(0)),
    reason: detail(500),
    unitCents: z.number().int().nonnegative().max(10_000_000).optional(),
  })
  .strict();

export const purchaseInput = z
  .object({
    id: accountingId,
    workId: accountingId.or(z.literal("")),
    supplier: detail(150),
    supplierRuc: z
      .string()
      .regex(/^\d{11}$/)
      .or(z.literal("")),
    reason: detail(500),
    items: z
      .array(
        z
          .object({
            materialId: accountingId,
            requested: quantitySchema.or(z.literal(0)),
            ordered: quantitySchema,
            unitCents: z.number().int().positive().max(10_000_000),
            reason: detail(500),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine(
    ({ items }) =>
      new Set(items.map((row) => row.materialId.toLowerCase())).size ===
      items.length,
    "Registra cada código una sola vez por compra.",
  );
export const purchaseRequest = z
  .object({
    id: accountingId,
    workId: accountingId,
    reason: detail(500),
    materials: z
      .array(
        z
          .object({ materialId: accountingId, quantity: quantitySchema })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine(
    ({ materials }) =>
      new Set(materials.map((row) => row.materialId.toLowerCase())).size ===
      materials.length,
    "Registra cada código una sola vez por solicitud.",
  );

export const purchaseReceipt = z
  .object({
    operationId: z.uuid(),
    materialId: accountingId,
    quantity: quantitySchema,
    reference: z.string().trim().max(100).default(""),
  })
  .strict();

export type Purchase = Omit<z.infer<typeof purchaseInput>, "items"> & {
  workName: string;
  createdAt: string;
  actor: string;
  requestedAt?: string;
  requestedBy?: string;
  status: "requested" | "open" | "partial" | "received" | "cancelled";
  items: (z.infer<typeof purchaseInput>["items"][number] & {
    name: string;
    sku: string;
    unit: string;
    received: number;
  })[];
  invoiceSource?: {
    costId: string;
    reference: string;
    netCents: number;
    taxCents: number;
  };
  receipts: (z.infer<typeof purchaseReceipt> & {
    at: string;
    actor: string;
    applied: boolean;
  })[];
};

export const EQUIPMENT_CATEGORIES = [
  { id: "machine", name: "Máquina" },
  { id: "tool", name: "Herramienta" },
  { id: "support", name: "Equipo de apoyo" },
] as const;
export const equipmentCategory = z.enum(["machine", "tool", "support"]);
export const equipmentInput = z
  .object({
    id: accountingId,
    code: detail(60).transform((value) => value.toUpperCase()),
    name: detail(150),
    category: equipmentCategory.optional(),
    location: detail(150),
    condition: z.enum(["good", "maintenance", "retired"]),
  })
  .strict();
export const equipmentUpdateInput = equipmentInput
  .omit({ id: true, condition: true })
  .extend({ version: recordRevision })
  .strict();
export const equipmentAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("assign"),
      version: recordRevision,
      workId: accountingId,
      responsible: detail(100),
      expectedReturn: z.iso.date().optional(),
      note: z.string().trim().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("return"),
      version: recordRevision,
      location: detail(150),
      condition: equipmentInput.shape.condition,
      note: z.string().trim().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("condition"),
      version: recordRevision,
      location: detail(150),
      condition: equipmentInput.shape.condition,
      note: detail(500),
    })
    .strict(),
]);
export type Equipment = z.infer<typeof equipmentInput> & {
  version: number;
  assignment: {
    workId: string;
    workName: string;
    responsible: string;
    expectedReturn?: string;
    at: string;
  } | null;
  events: {
    action: "assign" | "return" | "condition" | "details";
    at: string;
    actor: string;
    note: string;
    workId?: string;
    workName?: string;
    responsible?: string;
    expectedReturn?: string;
    location?: string;
    condition?: Equipment["condition"];
  }[];
};

export const workPlanInput = z
  .object({
    revision: z.number().int().nonnegative(),
    budgetCents: z.number().int().nonnegative().max(999_999_999),
    materials: z
      .array(
        z
          .object({ materialId: accountingId, quantity: quantitySchema })
          .strict(),
      )
      .max(100),
    equipment: z.array(accountingId).max(100),
  })
  .strict()
  .refine(
    (data) =>
      new Set(data.materials.map((row) => row.materialId.toLowerCase()))
        .size === data.materials.length &&
      new Set(data.equipment.map((id) => id.toLowerCase())).size ===
        data.equipment.length,
    "No repitas códigos en el plan.",
  );

export type WorkPlan = z.infer<typeof workPlanInput> & {
  budgetSource?: { attachmentId: string; reference: string; date: string };
};
export type WorkSupply = {
  plan: WorkPlan;
  materials: {
    materialId: string;
    sku: string;
    name: string;
    unit: string;
    planned: number;
    requested: number;
    ordered: number;
    received: number;
    delivered: number;
    consumed: number;
    returned: number;
  }[];
  equipment: { id: string; code: string; name: string; assigned: boolean }[];
  purchases: Pick<Purchase, "id" | "supplier" | "status">[];
};
