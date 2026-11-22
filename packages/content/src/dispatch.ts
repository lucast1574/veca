import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
export const GUIDE_UNITS = [
  { id: "NIU", name: "Unidad" },
  { id: "MTR", name: "Metro" },
  { id: "MTK", name: "Metro cuadrado" },
  { id: "KGM", name: "Kilogramo" },
  { id: "LTR", name: "Litro" },
  { id: "SET", name: "Juego" },
] as const;

export const guideUnitForMaterial = {
  m2: "MTK",
  m: "MTR",
  unit: "NIU",
  kg: "KGM",
  l: "LTR",
} as const;

export const dispatchSchema = z
  .object({
    startAddress: text(250),
    startUbigeo: text(6),
    arrivalAddress: text(250),
    arrivalUbigeo: text(6),
    transferAt: text(30),
    motiveCode: z.enum(["01", "02", "13"]),
    motiveDescription: text(100),
    recipientType: z.enum(["1", "6"]),
    recipientNumber: text(11),
    recipientName: text(150),
    transportMode: z.enum(["01", "02"]),
    carrierRuc: text(11),
    carrierName: text(150),
    vehiclePlate: text(12),
    driverDocument: text(15),
    driverName: text(100),
    driverLastName: text(100),
    driverLicense: text(12),
    weightKg: z.number().finite().min(0).max(1_000_000),
    items: z
      .array(
        z
          .object({
            code: text(60),
            materialId: z
              .string()
              .regex(/^[a-f\d]{24}$/i)
              .optional(),
            description: text(250),
            unitCode: z.enum(["NIU", "MTR", "MTK", "KGM", "LTR", "SET"]),
            quantity: z.number().finite().min(0).max(1_000_000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type DispatchInput = z.infer<typeof dispatchSchema>;
export type DispatchStatus =
  | "draft"
  | "review"
  | "returned"
  | "sending"
  | "pending"
  | "accepted"
  | "observed"
  | "rejected";

export type Dispatch = DispatchInput & {
  id: string;
  leadId: string;
  workName: string;
  demo: boolean;
  version: number;
  status: DispatchStatus;
  observation: string;
  guideNumber: string;
  canCheckStatus: boolean;
  departedAt?: string;
};

export const DISPATCH_STATUS: Record<DispatchStatus, string> = {
  draft: "Borrador",
  review: "Por revisar",
  returned: "Devuelto a Operaciones",
  sending: "Confirmando envío",
  pending: "Confirmando envío",
  accepted: "Aceptada",
  observed: "Aceptada con observaciones",
  rejected: "Requiere corrección",
};
