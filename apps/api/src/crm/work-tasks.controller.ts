import {
  Body,
  Controller,
  ForbiddenException,
  ConflictException,
  Get,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import {
  workTaskInput,
  workTaskState,
  workTaskStatusLabels,
} from "@veca/content";
import { RequirePermission } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { WorkAccess } from "./work-access.service";
import { CrmRepository } from "./crm.repository";
import { CrmEvents } from "./crm.events";
import { WorkStageRequests } from "./work-stage-requests";

@Controller("admin/works/:id")
@RequirePermission("works")
export class WorkTasksController {
  constructor(
    private readonly access: WorkAccess,
    private readonly crm: CrmRepository,
    private readonly events: CrmEvents,
    private readonly stages: WorkStageRequests,
  ) {}

  @Get("tasks")
  async tasks(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const row = await this.access.get(id, req.session.user);
    return {
      items: row.workTasks || [],
      version: row.version,
      stage: row.stage,
      review: row.completionReview,
      stageRequest: row.stageRequest,
      people: row.workAssignment
        ? [
            {
              id: row.workAssignment.coordinatorId,
              name: row.workAssignment.coordinatorName,
            },
            ...row.workAssignment.participantIds.map((value, index) => ({
              id: value,
              name: row.workAssignment!.participantNames[index],
            })),
          ]
        : [],
    };
  }

  @Post("tasks")
  @RequirePermission("works_manage", "works")
  async create(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(workTaskInput, input);
    const row = await this.access.get(id, req.session.user);
    if (row.stage === "completed")
      throw new ConflictException("La obra ya está realizada.");
    const team = row.workAssignment;
    const ids = team ? [team.coordinatorId, ...team.participantIds] : [];
    const names = team ? [team.coordinatorName, ...team.participantNames] : [];
    if (!ids.includes(data.assignedTo))
      throw new ForbiddenException(
        "Asigna el pendiente a una persona del equipo de obra.",
      );
    const previous = (row.workTasks || []).find((task) => task.id === data.id);
    if (previous) {
      if (
        previous.title !== data.title ||
        previous.assignedTo !== data.assignedTo ||
        previous.dueDate !== data.dueDate
      )
        throw new ConflictException(
          "Este pendiente ya se registró con otros datos.",
        );
      return this.crm.view(row);
    }
    if ((row.workTasks?.length || 0) >= 200)
      throw new ConflictException("La obra alcanzó el límite de pendientes.");
    const { version, ...task } = data;
    const now = new Date().toISOString();
    const saved = await this.crm.change(
      id,
      version,
      {
        completionReview: null,
        workTasks: [
          ...(row.workTasks || []),
          {
            ...task,
            assignedName: names[ids.indexOf(task.assignedTo)],
            status: "pending",
            observation: "",
            updatedAt: now,
            updatedBy: req.session.user.id,
          },
        ],
      },
      {
        at: now,
        actor: req.session.user.username,
        kind: "task",
        text: `Pendiente asignado · ${task.title}`,
      },
    );
    this.events.emit("works");
    return saved;
  }

  @Put("tasks/:taskId")
  async update(
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(workTaskState, input);
    const user = req.session.user;
    const row = await this.access.get(id, user);
    const task = row.workTasks?.find((item) => item.id === taskId);
    if (
      !task ||
      (!user.permissions.includes("works_manage") &&
        !(
          user.permissions.includes("works_report") &&
          task.assignedTo === user.id
        ))
    )
      throw new ForbiddenException();
    if (row.stage === "completed")
      throw new ConflictException("La obra ya está realizada.");
    if (data.assignedTo && !user.permissions.includes("works_manage"))
      throw new ForbiddenException();
    const team = row.workAssignment;
    const ids = team ? [team.coordinatorId, ...team.participantIds] : [];
    const names = team ? [team.coordinatorName, ...team.participantNames] : [];
    if (data.assignedTo && !ids.includes(data.assignedTo))
      throw new ForbiddenException("Selecciona una persona del equipo.");
    const now = new Date().toISOString();
    const saved = await this.crm.change(
      id,
      data.version,
      {
        ...(data.status !== "done" ? { completionReview: null } : {}),
        workTasks: row.workTasks!.map((item) =>
          item.id === taskId
            ? {
                ...item,
                ...(data.assignedTo
                  ? {
                      assignedTo: data.assignedTo,
                      assignedName: names[ids.indexOf(data.assignedTo)],
                    }
                  : {}),
                status: data.status,
                observation: data.observation,
                updatedAt: now,
                updatedBy: user.id,
              }
            : item,
        ),
      },
      {
        at: now,
        actor: user.username,
        kind: "task",
        text: `Pendiente · ${task.title} · ${workTaskStatusLabels[data.status]}${data.observation ? " · " + data.observation : ""}`,
      },
    );
    this.events.emit("works");
    return saved;
  }

  @Post("completion-review")
  async review(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.request(id, input, req.session.user, "completed");
  }
}
