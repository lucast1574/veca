import { z } from "zod";
import { quantitySchema } from "./crm.js";
export const supplyId = z.string().regex(/^[a-f0-9]{24}$/);
export const supplyRequestInput = z
  .object({
    id: supplyId,
    materialId: supplyId,
    quantity: quantitySchema,
    neededBy: z.iso.date(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const supplyActionInput = z
  .object({
    operationId: z.uuid(),
    version: z.number().int().positive(),
    action: z.enum([
      "reserve",
      "cancel",
      "deliver",
      "receive",
      "request_return",
      "accept_return",
      "purchase",
    ]),
    quantity: quantitySchema.or(z.literal(0)),
    guideId: supplyId.optional(),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export type SupplyAction = z.infer<typeof supplyActionInput>;
export type SupplyRequest = z.infer<typeof supplyRequestInput> & {
  workId: string;
  workName: string;
  materialName: string;
  sku: string;
  unit: string;
  available?: number;
  version: number;
  reserved: number;
  delivered: number;
  received: number;
  returnRequested: number;
  returned: number;
  cancelled: boolean;
  purchaseId?: string;
  createdAt: string;
  requestedBy: string;
  operations: (SupplyAction & {
    actor: string;
    at: string;
    completed: boolean;
    failed?: boolean;
  })[];
  pending?: SupplyAction & { actor: string; at: string; completed: boolean };
};
export const supplyActionLabels: Record<SupplyAction["action"], string> = {
  reserve: "Reservar",
  cancel: "Cancelar solicitud",
  deliver: "Confirmar salida",
  receive: "Confirmar recepción en obra",
  request_return: "Solicitar devolución",
  accept_return: "Recibir devolución",
  purchase: "Solicitar compra del faltante",
};
