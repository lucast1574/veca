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
