import { randomUUID } from "node:crypto";
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ObjectId, type Document } from "mongodb";
import { Subject } from "rxjs";
import type { Permission, SessionUser, PanelNotification } from "@veca/content";
import type { LeadDocument } from "../crm/crm.repository";
import { Database } from "../database/database.module";
import { AuthService } from "../auth/auth.service";
import { digest } from "../auth/auth.crypto";
import { FirebasePush } from "./firebase-push";
import { fiscalIssuerRuc } from "../common/fiscal-config";
type Scope = "team" | "coordinator" | "commercial" | "editorial" | "self";
type NotificationDocument = {
  _id: string;
  userId: string;
  workId?: string;
  workRef?: ObjectId;
  scope: Scope;
  permission: Permission;
  requiredPermissions?: Permission[];
  title: string;
  body: string;
  href: string;
  createdAt: Date;
  readAt: Date | null;
  pushState: "pending" | "sent" | "skipped";
  attempts: number;
  nextAttempt: Date;
  leaseUntil?: Date;
};
type PushDevice = {
  _id: string;
  token: string;
  userId: string;
  sessionHash: string;
  enabledAt: Date;
  expiresAt: Date;
};
@Injectable()
export class Notifications implements OnModuleInit, OnModuleDestroy {
  readonly changes = new Subject<{ userId: string }>();
  private readonly logger = new Logger(Notifications.name);
  private timer?: NodeJS.Timeout;
  private processing = false;
  private reconcilingPayroll = false;
  private peopleCache?: { at: number; users: SessionUser[] };
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly push: FirebasePush,
  ) {}
  private get collection() {
    return this.db.db.collection<NotificationDocument>("notifications");
  }
  private get devices() {
    return this.db.db.collection<PushDevice>("push_devices");
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.recoverPayrollDeductions()
        .then(() => this.deliver())
        .catch(() =>
          this.logger.warn("No se pudo procesar la cola de avisos."),
        );
    }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.changes.complete();
  }
  private active(user: SessionUser) {
    if (user.status !== "active" || !user.emailVerified)
      throw new ForbiddenException(
        "Tu cuenta aún no tiene acceso al espacio de trabajo.",
      );
  }
  private async people() {
    if (this.peopleCache && Date.now() - this.peopleCache.at < 3000)
      return this.peopleCache.users;
    const roles = await this.auth.roles.list();
    const rows = await this.auth.users
      .find({ mobileReview: { $ne: true } })
      .toArray();
    const users = (
      await Promise.all(rows.map((row) => this.auth.view(row, roles)))
    ).filter((user) => user.status === "active" && user.emailVerified);
    this.peopleCache = { at: Date.now(), users };
    return users;
  }
  refreshAudience() {
    this.peopleCache = undefined;
  }
  private pipeline(user: SessionUser): Document[] {
    this.active(user);
    return [
      {
        $match: {
          userId: user.id,
          permission: { $in: user.permissions },
          $expr: {
            $setIsSubset: [
              { $ifNull: ["$requiredPermissions", []] },
              user.permissions,
            ],
          },
          ...(!user.permissions.includes("works")
            ? { scope: { $nin: ["team", "coordinator"] } }
            : {}),
        },
      },
      {
        $lookup: {
          from: "crm_leads",
          localField: "workRef",
          foreignField: "_id",
          pipeline: [{ $project: { workAssignment: 1 } }],
          as: "work",
        },
      },
      {
        $match: {
          $or: [
            { scope: "self" },
            {
              scope: { $in: ["commercial", "editorial"] },
              "work.0": { $exists: true },
            },
            {
              scope: "coordinator",
              "work.workAssignment.coordinatorId": user.id,
            },
            {
              scope: "team",
              $or: [
                { "work.workAssignment.coordinatorId": user.id },
                { "work.workAssignment.participantIds": user.id },
              ],
            },
          ],
        },
      },
    ];
  }
  async list(user: SessionUser) {
    const [result] = await this.collection
      .aggregate<{
        items: NotificationDocument[];
        unread: { count: number }[];
      }>([
        ...this.pipeline(user),
        {
          $facet: {
            items: [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 50 }],
            unread: [{ $match: { readAt: null } }, { $count: "count" }],
          },
        },
      ])
      .toArray();
    return {
      items: (result?.items || []).map(
        (row): PanelNotification => ({
          id: row._id,
          title: row.title,
          body: row.body,
          href: row.href,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() || null,
        }),
      ),
      unread: result?.unread[0]?.count || 0,
    };
  }
  async detail(user: SessionUser, id: string) {
    const [notice] = await this.collection
      .aggregate<NotificationDocument>([
        ...this.pipeline(user),
        { $match: { _id: id } },
        { $limit: 1 },
      ])
      .toArray();
    if (!notice) throw new NotFoundException("Aviso no encontrado.");
    return { id: notice._id, href: notice.href };
  }
  async read(user: SessionUser, id?: string) {
    const visible = await this.collection
      .aggregate<NotificationDocument>([
        ...this.pipeline(user),
        ...(id ? [{ $match: { _id: id } }] : []),
        { $project: { _id: 1 } },
      ])
      .toArray();
    if (id && !visible.length)
      throw new NotFoundException("Aviso no encontrado.");
    await this.collection.updateMany(
      {
        _id: { $in: visible.map((row) => row._id) },
        userId: user.id,
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );
    this.changes.next({ userId: user.id });
    return { ok: true };
  }
  private async add(
    key: string,
    user: SessionUser,
    notice: Pick<
      NotificationDocument,
      | "scope"
      | "permission"
      | "requiredPermissions"
      | "title"
      | "body"
      | "href"
      | "workId"
    >,
  ) {
    if (!user.permissions.includes(notice.permission)) return;
    if (
      notice.requiredPermissions?.some(
        (permission) => !user.permissions.includes(permission),
      )
    )
      return;
    if (
      ["team", "coordinator"].includes(notice.scope) &&
      !user.permissions.includes("works")
    )
      return;
    const now = new Date();
    const result = await this.collection.updateOne(
      { _id: digest(key + ":" + user.id) },
      {
        $setOnInsert: {
          ...notice,
          ...(notice.workId ? { workRef: new ObjectId(notice.workId) } : {}),
          userId: user.id,
          createdAt: now,
          readAt: null,
          pushState: "pending",
          attempts: 0,
          nextAttempt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) this.changes.next({ userId: user.id });
  }
  async forPayrollDeduction(id: string) {
    const incidents = this.db.db.collection("work_payroll_incidents");
    const row = await incidents.findOne({
      _id: new ObjectId(id),
      issuerRuc: fiscalIssuerRuc,
    });
    if (!row) return;
    if (row.status === "authorized" && !row.payrollRunId) {
      this.refreshAudience();
      await Promise.all(
        (await this.people())
          .filter(
            (user) =>
              user.permissions.includes("accounting") &&
              user.permissions.includes("accounting_labor"),
          )
          .map((user) =>
            this.add("payroll-deduction:" + id, user, {
              scope: "self",
              permission: "accounting_labor",
              requiredPermissions: ["accounting", "accounting_labor"],
              title: "Descuento al personal por aprobar",
              body: `${row.employeeName} · ${row.workName}. Revisa el sustento del descuento del periodo ${row.period}.`,
              href: `#accounting/personal?month=${row.period}&section=descuentos`,
            }),
          ),
      );
    }
    await incidents.updateOne(
      { _id: row._id, revision: row.revision },
      { $set: { notificationPending: false } },
    );
  }
  private async recoverPayrollDeductions() {
    if (this.reconcilingPayroll) return;
    this.reconcilingPayroll = true;
    try {
      const rows = await this.db.db
        .collection("work_payroll_incidents")
        .find({ issuerRuc: fiscalIssuerRuc, notificationPending: true })
        .project({ _id: 1 })
        .limit(100)
        .toArray();
      for (const row of rows) await this.forPayrollDeduction(String(row._id));
    } finally {
      this.reconcilingPayroll = false;
    }
  }
  async forGuideRequest(id: string) {
    const guide = await this.db.db.collection("dispatches").findOne({
      _id: new ObjectId(id),
      status: "review",
      supplyRequestId: { $exists: true },
    });
    if (!guide) return;
    const people = await this.people();
    await Promise.all(
      people
        .filter(
          (user) =>
            user.permissions.includes("accounting") &&
            user.permissions.includes("accounting_write"),
        )
        .map((user) =>
          this.add("supply-guide:" + id, user, {
            scope: "self",
            permission: "accounting",
            title: "Guía de remisión solicitada",
            body: `Almacén solicita preparar el traslado a ${String(guide.workName)}. Revisa los datos del transporte antes de emitir.`,
            href: `#accounting/guias/${id}`,
          }),
        ),
    );
  }
  async forAccountingPurchase(id: string) {
    const order = await this.db.db
      .collection("warehouse_purchases")
      .findOne({ _id: new ObjectId(id) });
    if (!order || order.cancelled || !order.requestedOnly) return;
    const people = await this.people();
    await Promise.all(
      people
        .filter(
          (user) =>
            user.permissions.includes("accounting") &&
            user.permissions.includes("accounting_write"),
        )
        .map((user) =>
          this.add("accounting-purchase:" + id, user, {
            scope: "self",
            permission: "accounting",
            title: "Compra de materiales por completar",
            body: "Registra los materiales, las cantidades compradas y sus precios unitarios para que Almacén confirme la entrega.",
            href: `#accounting/gastos/${id}/preparar`,
          }),
        ),
    );
  }
  async forWarehousePurchase(id: string) {
    const order = await this.db.db
      .collection("warehouse_purchases")
      .findOne({ _id: new ObjectId(id) });
    if (
      !order ||
      order.cancelled ||
      order.requestedOnly ||
      order.items.every(
        (item: { received: number; ordered: number }) =>
          item.received >= item.ordered,
      )
    )
      return;
    const people = await this.people();
    await Promise.all(
      people
        .filter(
          (user) =>
            user.permissions.includes("inventory") &&
            user.permissions.includes("inventory_receive"),
        )
        .map((user) =>
          this.add("warehouse-invoice:" + id, user, {
            scope: "self",
            permission: "inventory",
            title: "Materiales por recibir",
            body: "Contabilidad registró los materiales y cantidades compradas. Confirma la cantidad que llegue realmente al almacén.",
            href: `#inventory/compras/${id}`,
          }),
        ),
    );
  }
  async forWork(row: LeadDocument) {
    const people = await this.people(),
      id = String(row._id),
      name = row.workName || row.name;
    const send = async (
      key: string,
      recipients: (user: SessionUser) => boolean,
      notice: Omit<Parameters<Notifications["add"]>[2], "workId">,
    ) => {
      await Promise.all(
        people
          .filter(recipients)
          .map((user) =>
            this.add(id + ":" + key, user, { ...notice, workId: id }),
          ),
      );
    };
    const team = row.workAssignment;
    if (row.stage === "prelead")
      await send("lead", (user) => user.permissions.includes("leads"), {
        scope: "commercial",
        permission: "leads",
        title: "Nuevo lead",
        body: row.name + " · Primer contacto pendiente",
        href: `#leads/${id}`,
      });
    if (team && row.workHandoff?.status === "submitted")
      await send(
        "handoff:" + row.workHandoff.submittedAt,
        (user) => user.id === team.coordinatorId,
        {
          scope: "coordinator",
          permission: "works_manage",
          title: "Entrega a Operaciones",
          body: name + " · Revisa y acepta la entrega",
          href: `#works/${id}`,
        },
      );
    if (row.workHandoff?.status === "returned")
      await send(
        "handoff-return:" + row.workHandoff.decidedAt,
        (user) => user.id === row.workHandoff!.submittedBy,
        {
          scope: "commercial",
          permission: "leads",
          title: "Entrega devuelta",
          body: name + " · " + row.workHandoff.observation,
          href: `#leads/${id}`,
        },
      );
    const request = row.stageRequest;
    if (team && request) {
      const pending = request.status === "pending";
      await send(
        "stage:" + request.id + ":" + request.status,
        (user) =>
          pending
            ? user.id === team.coordinatorId
            : request.status === "returned"
              ? user.id === request.requestedBy
              : team.participantIds.includes(user.id),
        {
          scope: pending ? "coordinator" : "team",
          permission: pending ? "works_manage" : "works",
          title: pending
            ? "Solicitud de avance"
            : request.status === "approved"
              ? "Avance aprobado"
              : "Avance devuelto",
          body:
            name +
            " · " +
            (pending
              ? request.requestedName + " solicita la siguiente etapa"
              : request.status === "returned"
                ? request.observation
                : "La etapa se actualizó en Leads y Obras"),
          href: `#works/${id}`,
        },
      );
    }
    if (team && row.stage !== "completed")
      for (const task of row.workTasks || []) {
        if (task.status !== "done")
          await send(
            "task:" + task.id + ":" + task.updatedAt,
            (user) => user.id === task.assignedTo,
            {
              scope: "team",
              permission: "works",
              title: "Pendiente de obra",
              body: name + " · " + task.title,
              href: `#works/${id}/tasks`,
            },
          );
        if (task.status === "blocked")
          await send(
            "blocked:" + task.id + ":" + task.updatedAt,
            (user) => user.id === team.coordinatorId,
            {
              scope: "coordinator",
              permission: "works_manage",
              title: "Trabajo bloqueado",
              body: name + " · " + task.observation,
              href: `#works/${id}/tasks`,
            },
          );
      }
    if (row.stage === "completed")
      await send("completed", (user) => user.permissions.includes("projects"), {
        scope: "editorial",
        permission: "projects",
        title: "Obra lista para publicar",
        body: name + " · Elige sus fotos y prepara el proyecto",
        href: `#projects/from-work/${id}`,
      });
  }
  async register(user: SessionUser, sessionHash: string, token: string) {
    this.active(user);
    if (!this.push.configured)
      throw new ForbiddenException(
        "Los avisos del navegador aún no están disponibles.",
      );
    const id = digest(token),
      old = await this.devices.findOne({ _id: id });
    await this.devices.updateOne(
      { _id: id },
      {
        $set: {
          token,
          userId: user.id,
          sessionHash,
          enabledAt:
            old?.userId === user.id && old.sessionHash === sessionHash
              ? old.enabledAt
              : new Date(),
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      },
      { upsert: true },
    );
    return { ok: true };
  }
  async unregister(user: SessionUser, sessionHash: string) {
    await this.devices.deleteMany({ userId: user.id, sessionHash });
    return { ok: true };
  }
  async test(user: SessionUser) {
    this.active(user);
    if (!this.push.configured)
      throw new ForbiddenException(
        "Los avisos del navegador aún no están disponibles.",
      );
    await this.add("test:" + randomUUID(), user, {
      scope: "self",
      permission: user.permissions[0],
      title: "Aviso de prueba",
      body: "Este aviso confirma la conexión de tu navegador con VECA.",
      href: "#profile",
    });
    void this.deliver();
    return { ok: true };
  }
  async deliver() {
    if (this.processing || !this.push.configured) return;
    this.processing = true;
    try {
      for (let count = 0; count < 30; count++) {
        const now = new Date();
        const notice = await this.collection.findOneAndUpdate(
          {
            pushState: "pending",
            nextAttempt: { $lte: now },
            $or: [
              { leaseUntil: { $exists: false } },
              { leaseUntil: { $lt: now } },
            ],
          },
          { $set: { leaseUntil: new Date(Date.now() + 60000) } },
          { returnDocument: "after", sort: { createdAt: 1 } },
        );
        if (!notice) break;
        try {
          const row = await this.auth.users.findOne({
            _id: new ObjectId(notice.userId),
          });
          const user = row && (await this.auth.view(row));
          const visible =
            user &&
            user.status === "active" &&
            user.emailVerified &&
            (await this.collection
              .aggregate([
                ...this.pipeline(user),
                { $match: { _id: notice._id, readAt: null } },
                { $limit: 1 },
              ])
              .hasNext());
          if (visible) {
            const devices = await this.devices
              .find({
                userId: notice.userId,
                expiresAt: { $gt: now },
                enabledAt: { $lte: notice.createdAt },
              })
              .toArray();
            for (const device of devices) {
              const session = await this.db.db.collection("sessions").findOne({
                tokenHash: device.sessionHash,
                userId: new ObjectId(notice.userId),
                expiresAt: { $gt: new Date() },
                mobile: { $ne: true },
              });
              if (!session) {
                await this.devices.deleteOne({
                  _id: device._id,
                  sessionHash: device.sessionHash,
                });
                continue;
              }
              try {
                await this.push.send(device.token, {
                  id: notice._id,
                  title: notice.title,
                  href: notice.href,
                });
              } catch (error) {
                const code = (error as { code?: string }).code;
                if (
                  [
                    "messaging/registration-token-not-registered",
                    "messaging/invalid-registration-token",
                  ].includes(code || "")
                )
                  await this.devices.deleteOne({
                    _id: device._id,
                    sessionHash: device.sessionHash,
                  });
                else throw error;
              }
            }
          }
          await this.collection.updateOne(
            { _id: notice._id },
            {
              $set: { pushState: visible ? "sent" : "skipped" },
              $unset: { leaseUntil: "" },
            },
          );
        } catch {
          const attempts = notice.attempts + 1;
          await this.collection.updateOne(
            { _id: notice._id },
            {
              $set: {
                attempts,
                pushState: attempts >= 5 ? "skipped" : "pending",
                nextAttempt: new Date(Date.now() + 30000 * attempts),
              },
              $unset: { leaseUntil: "" },
            },
          );
          this.logger.warn(
            "Un aviso del navegador quedó pendiente de reintento.",
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
