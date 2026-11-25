import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import {
  canViewAdministration,
  type LaborWorkspace,
  type MyPayroll,
  type PayrollRun,
  type SessionUser,
  type WorkPayrollIncident,
  type workPayrollIncidentInput,
  type incidentAuthorizationInput,
} from "@veca/content";
import type { z } from "zod";
import { Database } from "../database/database.module";
import { LaborProvider } from "../accounting/labor-provider";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { Notifications } from "../notifications/notifications.service";
import { WorkAccess } from "../crm/work-access.service";

type Incident = Omit<WorkPayrollIncident, "id" | "payrollStatus"> & {
  _id: ObjectId;
  issuerRuc: string;
  claimId?: string;
  notificationPending?: boolean;
  events: { action: string; by: string; at: string }[];
};
type Link = {
  _id: string;
  issuerRuc: string;
  employeeId: string;
  userId: string | null;
  revision: number;
  updatedBy: string;
  updatedAt: string;
};
@Injectable()
export class PersonnelService {
  private readonly logger = new Logger(PersonnelService.name);
  constructor(
    private readonly database: Database,
    private readonly provider: LaborProvider,
    private readonly access: WorkAccess,
    private readonly notices: Notifications,
  ) {}
  get incidents() {
    return this.database.db.collection<Incident>("work_payroll_incidents");
  }
  private get links() {
    return this.database.db.collection<Link>("labor_employee_accounts");
  }
  view(row: Incident, runs: PayrollRun[] = []): WorkPayrollIncident {
    const { _id, issuerRuc, claimId, events, notificationPending, ...data } =
      row;
    return {
      ...data,
      id: String(_id),
      ...(row.payrollRunId
        ? { payrollStatus: runs.find((r) => r.id === row.payrollRunId)?.status }
        : {}),
    };
  }
  async accounts() {
    return this.database.db
      .collection("users")
      .find({ status: "active" })
      .project({ name: 1, username: 1 })
      .sort({ name: 1 })
      .toArray()
      .then((rows) =>
        rows.map((r) => ({
          id: String(r._id),
          name: String(r.name || r.username),
          username: String(r.username),
        })),
      );
  }
  async link(
    employeeId: string,
    userId: string | null,
    revision: number,
    actor: string,
  ) {
    if (!(await this.provider.employees()).some((e) => e.id === employeeId))
      throw new NotFoundException("Trabajador no encontrado.");
    if (
      userId &&
      !(await this.database.db
        .collection("users")
        .findOne({ _id: new ObjectId(userId), status: "active" }))
    )
      throw new NotFoundException("Selecciona una cuenta activa.");
    try {
      const saved = await this.links.findOneAndUpdate(
        { _id: `${fiscalIssuerRuc}:${employeeId}`, revision },
        {
          $set: {
            issuerRuc: fiscalIssuerRuc,
            employeeId,
            userId,
            updatedBy: actor,
            updatedAt: new Date().toISOString(),
          },
          $inc: { revision: 1 },
        },
        { upsert: revision === 0, returnDocument: "after" },
      );
      if (!saved)
        throw new ConflictException(
          "La vinculación cambió. Actualiza los datos.",
        );
      return { ok: true };
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new ConflictException(
          "La cuenta ya está vinculada a otro trabajador o la vinculación cambió.",
        );
      throw e;
    }
  }
  async enrich(data: LaborWorkspace): Promise<LaborWorkspace> {
    const [links, accounts, incidents] = await Promise.all([
      this.links.find({ issuerRuc: fiscalIssuerRuc }).toArray(),
      this.accounts(),
      this.incidents
        .find({ issuerRuc: fiscalIssuerRuc, period: data.period })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    return {
      ...data,
      employees: data.employees.map((e) => {
        const link = links.find((l) => l.employeeId === e.id);
        return {
          ...e,
          ...(link
            ? {
                account: {
                  userId: link.userId,
                  userName:
                    accounts.find((a) => a.id === link.userId)?.name ||
                    "Cuenta no activa",
                  revision: link.revision,
                },
              }
            : {}),
        };
      }),
      runs: data.runs.map((r) => ({
        ...r,
        workDeductions: incidents
          .filter((i) => i.payrollRunId === r.id)
          .map((i) => this.view(i, data.runs)),
      })),
      incidents: incidents.map((i) => this.view(i, data.runs)),
    };
  }
  private canManage(
    work: { workAssignment?: { coordinatorId?: string } },
    user: SessionUser,
  ) {
    return (
      canViewAdministration(user) ||
      (work.workAssignment?.coordinatorId === user.id &&
        user.permissions.includes("works_manage"))
    );
  }
  async work(workId: string, user: SessionUser) {
    const work = await this.access.get(workId, user);
    workId = String(work._id);
    const canManage = this.canManage(work, user);
    const link = canManage
      ? null
      : await this.links.findOne({
          issuerRuc: fiscalIssuerRuc,
          userId: user.id,
        });
    const rows =
      canManage || link
        ? await this.incidents
            .find({
              issuerRuc: fiscalIssuerRuc,
              workId,
              ...(!canManage ? { employeeId: link!.employeeId } : {}),
            })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray()
        : [];
    let employees: { id: string; name: string; position: string }[] = [];
    let employeeError = "";
    if (canManage)
      try {
        employees = (await this.provider.employees())
          .filter((e) => e.active)
          .map((e) => ({ id: e.id, name: e.name, position: e.position }));
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        employeeError =
          "No pudimos consultar los trabajadores de Planilla. Actualiza para reintentar.";
      }

    return {
      canManage,
      employees,
      employeeError,
      items: rows.map((r) => this.view(r)),
    };
  }
  private async assertOpenPeriod(employeeId: string, period: string) {
    if (
      (await this.provider.runs()).some(
        (run) =>
          run.period === period &&
          (run.status === "approved" || run.status === "paid") &&
          run.lines.some((line) => line.employeeId === employeeId),
      )
    )
      throw new ConflictException(
        "Ese periodo ya tiene una planilla aprobada o pagada. Registra la incidencia en un periodo abierto con Contabilidad.",
      );
  }
  async create(
    workId: string,
    data: z.infer<typeof workPayrollIncidentInput>,
    user: SessionUser,
  ) {
    const work = await this.access.get(workId, user);
    if (!this.canManage(work, user))
      throw new ForbiddenException(
        "Solo el encargado asignado a esta obra o un administrador puede registrar incidencias.",
      );
    const employee = (await this.provider.employees()).find(
      (e) => e.id === data.employeeId && e.active,
    );
    if (!employee)
      throw new NotFoundException(
        "Selecciona un trabajador activo de Planilla.",
      );
    const { id, ...values } = data;
    if (!(await this.incidents.findOne({ _id: new ObjectId(id) })))
      await this.assertOpenPeriod(data.employeeId, data.period);
    const now = new Date().toISOString();
    const saved = await this.incidents.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $setOnInsert: {
          ...values,
          workId: String(work._id),
          workName: work.workName || work.name,
          employeeName: employee.name,
          issuerRuc: fiscalIssuerRuc,
          revision: 0,
          status: "reported",
          createdBy: user.username,
          createdAt: now,
          events: [{ action: "reported", by: user.username, at: now }],
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (
      !saved ||
      saved.workId !== String(work._id) ||
      saved.issuerRuc !== fiscalIssuerRuc ||
      Object.entries(values).some(([k, v]) => saved[k as keyof Incident] !== v)
    )
      throw new ConflictException(
        "Esta incidencia ya fue registrada con otros datos.",
      );
    return this.view(saved);
  }
  async transition(
    workId: string,
    id: string,
    revision: number,
    user: SessionUser,
    authorization?: z.infer<typeof incidentAuthorizationInput>,
  ) {
    const work = await this.access.get(workId, user);
    if (!this.canManage(work, user))
      throw new ForbiddenException(
        "Solo el encargado de esta obra o un administrador puede modificar la incidencia.",
      );
    if (authorization) {
      const current = await this.incidents.findOne({
        _id: new ObjectId(id),
        issuerRuc: fiscalIssuerRuc,
        workId: String(work._id),
      });
      if (!current) throw new NotFoundException("Incidencia no encontrada.");
      await this.assertOpenPeriod(current.employeeId, current.period);
    }
    const now = new Date().toISOString();
    const saved = await this.incidents.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        issuerRuc: fiscalIssuerRuc,
        workId: String(work._id),
        revision,
        status: authorization ? "reported" : { $ne: "cancelled" },
        claimId: { $exists: false },
        payrollRunId: { $exists: false },
      },
      {
        $set: {
          status: authorization ? "authorized" : "cancelled",
          notificationPending: !!authorization,
          ...(authorization
            ? {
                authorization: {
                  basis: authorization.basis,
                  reference: authorization.reference,
                  by: user.username,
                  at: now,
                },
              }
            : {}),
        },
        $inc: { revision: 1 },
        $push: {
          events: {
            action: authorization ? "authorized" : "cancelled",
            by: user.username,
            at: now,
          },
        },
      },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException(
        "La incidencia cambió o ya está incorporada en una planilla. Actualiza los datos.",
      );
    if (authorization) {
      try {
        await this.notices.forPayrollDeduction(String(saved._id));
      } catch {
        this.logger.warn(
          "El aviso de un descuento al personal se volverá a intentar.",
        );
      }
    }
    return this.view(saved);
  }
  async mine(userId: string, period: string): Promise<MyPayroll> {
    const link = await this.links.findOne({
      issuerRuc: fiscalIssuerRuc,
      userId,
    });
    if (!link) return { linked: false, period };
    const [employees, regimes, runs, incidents] = await Promise.all([
      this.provider.employees(),
      this.provider.regimes(),
      this.provider.runs(),
      this.incidents
        .find({
          issuerRuc: fiscalIssuerRuc,
          employeeId: link.employeeId,
          period,
          status: { $ne: "cancelled" },
        })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    const employee = employees.find((e) => e.id === link.employeeId);
    if (!employee) return { linked: false, period };
    const run = runs.find(
      (r) =>
        r.period === period &&
        r.status !== "void" &&
        r.lines.some((l) => l.employeeId === employee.id),
    );
    return {
      linked: true,
      period,
      employeeName: employee.name,
      position: employee.position,
      salaryCents: employee.salaryCents,
      regimeLabel:
        regimes.find((r) => r.code === employee.laborRegime)?.label ||
        employee.laborRegime,
      run: run
        ? {
            id: run.id,
            period: run.period,
            status: run.status,
            paidAt: run.paidAt,
            paymentReference: run.paymentReference,
          }
        : null,
      line: run?.lines.find((l) => l.employeeId === employee.id) || null,
      incidents: incidents.map((i) => this.view(i, runs)),
    };
  }
}
