import { z } from "zod";
const personId = z.string().regex(/^[a-f0-9]{24}$/);
export const workTeamSchema = z
  .object({
    coordinatorId: personId,
    participantIds: z
      .array(personId)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Hay participantes repetidos.",
      ),
  })
  .strict();
export const workHandoffSchema = workTeamSchema
  .extend({
    version: z.number().int().positive(),
    address: z
      .string()
      .trim()
      .min(5, "Completa la dirección de la obra.")
      .max(500),
    workPlan: z
      .string()
      .trim()
      .min(10, "Describe el alcance de la obra.")
      .max(6000),
  })
  .strict();
export type WorkTeam = z.infer<typeof workTeamSchema>;
export type WorkPerson = { id: string; name: string; canCoordinate: boolean };
export const workTaskInput = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    title: z.string().trim().min(3).max(160),
    assignedTo: personId,
    dueDate: z.iso.date(),
  })
  .strict();
export const workTaskState = z
  .object({
    assignedTo: personId.optional(),
    version: z.number().int().positive(),
    status: z.enum(["pending", "in_progress", "blocked", "done"]),
    observation: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (data) => data.status !== "blocked" || data.observation.length >= 5,
    "Explica qué impide continuar.",
  );
export type WorkTask = Omit<z.infer<typeof workTaskInput>, "version"> & {
  assignedName: string;
  status: "pending" | "in_progress" | "blocked" | "done";
  observation: string;
  updatedAt: string;
  updatedBy: string;
};

export const workTaskStatusLabels: Record<WorkTask["status"], string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  blocked: "Bloqueado",
  done: "Terminado",
};
