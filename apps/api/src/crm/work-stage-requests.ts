import { randomUUID } from "node:crypto";
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Injectable,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  LEAD_STAGES,
  leadUpdateSchema,
  nextWorkStage,
  workStageDecisionInput,
  workStageRequestInput,
  type SessionUser,
  type WorkStageRequest,
} from "@veca/content";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { WorkAccess } from "./work-access.service";
import { CrmRepository } from "./crm.repository";
import { CrmService } from "./crm.service";
import { CrmEvents } from "./crm.events";

@Injectable()
export class WorkStageRequests {
  constructor(
    private readonly access: WorkAccess,
    private readonly crm: CrmRepository,
    private readonly service: CrmService,
    private readonly events: CrmEvents,
  ) {}

  async request(
    id: string,
    input: unknown,
    user: SessionUser,
    expected?: "completed",
  ) {
    const data = parse(workStageRequestInput, input);
    const row = await this.access.get(id, user);
    const team = row.workAssignment;
    if (
      !team ||
      ![team.coordinatorId, ...team.participantIds].includes(user.id) ||
      !user.permissions.some(
        (p) => p === "works_manage" || p === "works_report",
      )
    )
      throw new ForbiddenException(
        "Solo el equipo asignado puede solicitar el avance de la obra.",
      );
    const to = nextWorkStage(row.stage);
    if (
      !to ||
      (expected && expected !== to) ||
      ((row.workHandoffRequired || row.workHandoff) &&
        row.workHandoff?.status !== "accepted")
    )
      throw new ConflictException(
        "La entrega debe estar aceptada y la obra debe tener una siguiente etapa.",
      );
    if (row.stageRequest?.status === "pending")
      throw new ConflictException(
        "Ya hay una solicitud de avance pendiente de aprobación.",
      );
    if (
      to === "completed" &&
      row.workTasks?.some((task) => task.status !== "done")
    )
      throw new ConflictException(
        "Completa los pendientes de la obra antes de solicitar su cierre.",
      );
    const now = new Date().toISOString();
    const request: WorkStageRequest = {
      id: randomUUID(),
      from: row.stage as WorkStageRequest["from"],
      to,
      status: "pending",
      note: data.note,
      requestedBy: user.id,
      requestedName: user.name,
      requestedAt: now,
    };
    const saved = await this.crm.change(
      id,
      data.version,
      {
        stageRequest: request,
        ...(to === "completed"
          ? {
              completionReview: {
                requestedBy: user.id,
                requestedAt: now,
                note: data.note,
              },
            }
          : {}),
      },
      {
        at: now,
        actor: user.username,
        kind: "review",
        text: `Avance solicitado a ${LEAD_STAGES.find((stage) => stage.id === to)!.name} · ${data.note}`,
      },
    );
    this.events.emit("works");
    return saved;
  }

  async decide(
    id: string,
    requestId: string,
    input: unknown,
    user: SessionUser,
  ) {
    const data = parse(workStageDecisionInput, input);
    const row = await this.access.get(id, user);
    if (
      row.workAssignment?.coordinatorId !== user.id ||
      !user.permissions.includes("works_manage")
    )
      throw new ForbiddenException(
        "Solo el coordinador asignado puede revisar esta solicitud.",
      );
    const request = row.stageRequest;
    if (
      !request ||
      request.id !== requestId ||
      request.status !== "pending" ||
      request.from !== row.stage ||
      request.to !== nextWorkStage(row.stage)
    )
      throw new ConflictException(
        "Esta solicitud ya cambió o fue atendida. Actualiza la ficha.",
      );
    if (data.action === "approved") {
      // Reuse the CRM transition and its guarded closeout; approval and stage are one write.
      const fields = Object.fromEntries(
        Object.keys(leadUpdateSchema.shape).map((key) => [
          key,
          row[key as keyof typeof row],
        ]),
      );
      return this.service.update(
        id,
        {
          ...fields,
          version: data.version,
          stage: request.to,
          ...(request.to === "completed"
            ? { completionNote: data.observation || request.note }
            : {}),
        },
        user.username,
        { user, approval: { requestId, observation: data.observation } },
      );
    }
    const now = new Date().toISOString();
    const saved = await this.crm.change(
      id,
      data.version,
      {
        stageRequest: {
          ...request,
          status: "returned",
          observation: data.observation,
          decidedBy: user.id,
          decidedName: user.name,
          decidedAt: now,
        },
        completionReview: null,
      },
      {
        at: now,
        actor: user.username,
        kind: "review",
        text: `Solicitud de avance devuelta · ${data.observation}`,
      },
    );
    this.events.emit("works");
    return saved;
  }
}

@Controller("admin/works/:id/stage-requests")
@RequirePermission("works")
export class WorkStageController {
  constructor(private readonly requests: WorkStageRequests) {}
  @Post()
  request(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.request(id, input, req.session.user);
  }
  @Post(":requestId/decision")
  @RequirePermission("works_manage", "works")
  decide(
    @Param("id") id: string,
    @Param("requestId") requestId: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.decide(id, requestId, input, req.session.user);
  }
}
