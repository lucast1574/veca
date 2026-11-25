import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  workTeamSchema,
  workHandoffSchema,
  matchPeruLocation,
  formatPeruLocation,
  type SessionUser,
  type WorkTeam,
  type WorkPerson,
} from "@veca/content";
import type { Filter } from "mongodb";
import { AuthService } from "../auth/auth.service";
import { parse } from "../common/validation";
import { CrmRepository, type LeadDocument } from "./crm.repository";
import { CrmEvents } from "./crm.events";

export const workStages = ["coordination", "execution", "completed"] as const;

@Injectable()
export class WorkAccess {
  constructor(
    private readonly crm: CrmRepository,
    private readonly auth: AuthService,
    private readonly events: CrmEvents,
  ) {}

  scope(user: SessionUser, mine = false): Filter<LeadDocument> {
    const global =
      user.permissions.includes("works_all") ||
      user.permissions.includes("works_manage");
    const assignment: Filter<LeadDocument> = {
      $or: [
        { "workAssignment.coordinatorId": user.id },
        {
          "workAssignment.participantIds": user.id,
          $or: [
            { "workHandoff.status": "accepted" },
            { workHandoff: { $exists: false } },
          ],
        },
      ],
    };
    return {
      stage: { $in: [...workStages] },
      $and: [
        {
          $or: [
            { workHandoffRequired: { $ne: true } },
            { workHandoff: { $exists: true } },
          ],
        },
        ...(!global || mine ? [assignment] : []),
      ],
    };
  }

  async get(id: string, user: SessionUser) {
    const row = await this.crm.collection.findOne({
      _id: this.crm.id(id),
      ...this.scope(user),
    });
    if (!row) throw new NotFoundException("Obra no encontrada.");
    return row;
  }

  async people(): Promise<WorkPerson[]> {
    const roles = await this.auth.roles.list();
    const allowed = roles
      .filter((role) => role.permissions.includes("works"))
      .map((role) => role.id);
    const users = await this.auth.users
      .find({
        $or: [
          { roles: { $in: allowed } },
          { roles: { $exists: false }, role: { $in: allowed } },
        ],
        mobileReview: { $ne: true },
      })
      .sort({ name: 1, username: 1 })
      .toArray();
    const visible = await Promise.all(
      users.map((user) => this.auth.view(user, roles)),
    );
    return visible
      .filter(
        (user) =>
          user.permissions.includes("works") &&
          user.permissions.some(
            (p) => p === "works_manage" || p === "works_report",
          ),
      )
      .map((user) => ({
        id: user.id,
        name: user.name,
        canCoordinate: user.permissions.includes("works_manage"),
      }));
  }

  private async team(input: WorkTeam) {
    const people = await this.people();
    const coordinator = people.find(
      (person) => person.id === input.coordinatorId && person.canCoordinate,
    );
    const participants = input.participantIds.map((id) =>
      people.find((person) => person.id === id),
    );
    if (!coordinator || participants.some((person) => !person))
      throw new BadRequestException(
        "Selecciona personas activas con acceso operativo a Obras.",
      );
    if (input.participantIds.includes(input.coordinatorId))
      throw new BadRequestException(
        "El coordinador ya forma parte de la obra.",
      );
    return {
      ...input,
      coordinatorName: coordinator.name,
      participantNames: participants.map((person) => person!.name),
    };
  }

  async handoff(id: string, input: unknown, user: SessionUser) {
    const data = parse(workHandoffSchema, input);
    const row = await this.crm.get(id);
    if (
      row.stage !== "coordination" ||
      (row.workHandoff && row.workHandoff.status !== "returned")
    )
      throw new ConflictException(
        "La entrega solo se prepara en Coordinación y no puede reenviarse mientras esté en revisión.",
      );
    const team = await this.team({
      coordinatorId: data.coordinatorId,
      participantIds: data.participantIds,
    });
    const now = new Date().toISOString();
    const location = data.workLocation || row.workLocation || row.district;
    const match = matchPeruLocation(location);
    if (data.workLocation && !match)
      throw new BadRequestException("Elige una ubicación válida para la obra.");
    const saved = await this.crm.change(
      id,
      data.version,
      {
        address: data.address,
        workPlan: data.workPlan,
        workName: data.workName || row.workName || row.name,
        workLocation: match
          ? formatPeruLocation(match.region, match.locality)
          : location,
        assignedTo: team.coordinatorName,
        workAssignment: team,
        workHandoff: {
          status: "submitted",
          submittedBy: user.id,
          submittedAt: now,
          observation: "",
        },
      },
      {
        at: now,
        actor: user.username,
        kind: "handoff",
        text: `Entrega enviada a Operaciones · ${team.coordinatorName}`,
      },
    );
    this.events.emit("leads");
    return saved;
  }

  async assign(id: string, version: number, input: unknown, user: SessionUser) {
    await this.get(id, user);
    const team = await this.team(parse(workTeamSchema, input));
    const saved = await this.crm.change(
      id,
      version,
      { workAssignment: team, assignedTo: team.coordinatorName },
      {
        at: new Date().toISOString(),
        actor: user.username,
        kind: "assignment",
        text: `Equipo actualizado · ${[team.coordinatorName, ...team.participantNames].join(", ")}`,
      },
    );
    this.events.emit("leads");
    return saved;
  }

  async decide(
    id: string,
    version: number,
    action: "accepted" | "returned",
    observation: string,
    user: SessionUser,
  ) {
    const row = await this.get(id, user);
    if (row.workAssignment?.coordinatorId !== user.id)
      throw new ForbiddenException(
        "La entrega debe revisarla el coordinador asignado.",
      );
    if (row.stage !== "coordination" || row.workHandoff?.status !== "submitted")
      throw new ConflictException(
        "Esta entrega ya cambió. Actualiza la ficha.",
      );
    const now = new Date().toISOString();
    const saved = await this.crm.change(
      id,
      version,
      {
        workHandoff: {
          ...row.workHandoff,
          status: action,
          observation,
          decidedBy: user.id,
          decidedAt: now,
        },
      },
      {
        at: now,
        actor: user.username,
        kind: "handoff",
        text:
          action === "accepted"
            ? "Entrega aceptada por Operaciones."
            : `Entrega devuelta a Comercial · ${observation}`,
      },
    );
    this.events.emit("leads");
    return saved;
  }
}
