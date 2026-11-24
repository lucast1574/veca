import { WorkGate } from "./work-gate.service";
import { ConflictException, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import type {
  LeadEvent,
  LeadInput,
  WorkCheck,
  WorkCloseout,
} from "@veca/content";
import { Database } from "../database/database.module";
import { CrmRepository } from "./crm.repository";
@Injectable()
export class WorkReadiness {
  constructor(
    private readonly db: Database,
    private readonly crm: CrmRepository,
    private readonly gate: WorkGate,
  ) {}
  async snapshot(id: string): Promise<WorkCloseout> {
    await this.gate.reconcile(id);
    const work = await this.crm.get(id);
    const [supplies, equipment, guides, materialHeld] = await Promise.all([
      this.db.db
        .collection("supply_requests")
        .find({ workId: String(work._id) })
        .project({
          quantity: 1,
          delivered: 1,
          reserved: 1,
          received: 1,
          returnRequested: 1,
          cancelled: 1,
          pending: 1,
        })
        .toArray(),
      this.db.db
        .collection("warehouse_equipment")
        .countDocuments({ "assignment.workId": String(work._id) }),
      this.db.db
        .collection("dispatches")
        .find({ leadId: String(work._id), demo: { $ne: true } })
        .project({ status: 1, departedAt: 1 })
        .toArray(),
      this.db.db.collection("inventory_materials").countDocuments({
        [`workStock.${String(work._id)}.quantity`]: { $gt: 0 },
      }),
    ]);
    const checks: WorkCheck[] = [
      {
        key: "tasks",
        label: "Pendientes de trabajo sin terminar",
        count: (work.workTasks || []).filter((task) => task.status !== "done")
          .length,
        blocking: true,
      },
      {
        key: "operations",
        label: "Movimientos por confirmar",
        count: (work.activeOperations || []).length,
        blocking: true,
      },
      {
        key: "requests",
        label: "Solicitudes con faltantes sin cancelar",
        count: supplies.filter(
          (r) =>
            !r.cancelled && Math.round((r.quantity - r.delivered) * 1000) > 0,
        ).length,
        blocking: true,
      },
      {
        key: "reservations",
        label: "Solicitudes con material reservado",
        count: supplies.filter((r) => r.reserved > 0).length,
        blocking: true,
      },
      {
        key: "receipts",
        label: "Entregas sin recepción completa en obra",
        count: supplies.filter(
          (r) => Math.round((r.delivered - r.received) * 1000) > 0,
        ).length,
        blocking: true,
      },
      {
        key: "returns",
        label: "Devoluciones por recibir en Almacén",
        count: supplies.filter((r) => r.returnRequested > 0 || r.pending)
          .length,
        blocking: true,
      },
      {
        key: "held",
        label: "Materiales en obra sin consumo o devolución registrados",
        count: materialHeld,
        blocking: true,
      },
      {
        key: "equipment",
        label: "Equipos y herramientas asignados",
        count: equipment,
        blocking: true,
      },
      {
        key: "guides",
        label: "Guías en revisión, sin confirmar o sin salida",
        count: guides.filter(
          (g) =>
            ["review", "sending", "pending", "rejected", "returned"].includes(
              g.status,
            ) ||
            (["accepted", "observed"].includes(g.status) && !g.departedAt),
        ).length,
        blocking: true,
      },
      {
        key: "drafts",
        label: "Borradores de guía por revisar o descartar",
        count: guides.filter((g) => g.status === "draft").length,
        blocking: false,
      },
    ];
    return {
      stage: work.stage,
      checks,
      ready: !checks.some((check) => check.blocking && check.count > 0),
    };
  }
  async close(
    id: string,
    version: number,
    set: Partial<LeadInput>,
    event: LeadEvent,
  ) {
    await this.gate.reconcile(id);
    const token = `${id}:${version}`;
    const claimed = await this.crm.collection.findOneAndUpdate(
      {
        _id: this.crm.id(id),
        version,
        "activeOperations.0": { $exists: false },
        $or: [
          { closingOperation: { $exists: false } },
          { closingOperation: token },
        ],
      },
      { $set: { closingOperation: token } },
      { returnDocument: "after" },
    );
    if (!claimed)
      throw new ConflictException(
        "Hay movimientos en curso o la obra cambió. Actualiza la ficha antes del cierre.",
      );
    const readiness = await this.snapshot(id);
    if (!readiness.ready) {
      await this.crm.collection.updateOne(
        { _id: claimed._id, closingOperation: token },
        { $unset: { closingOperation: "" } },
      );
      throw new ConflictException(
        "Antes del cierre: " +
          readiness.checks
            .filter((c) => c.blocking && c.count)
            .map((c) => c.label)
            .join("; ") +
          ".",
      );
    }
    const saved = await this.crm.collection.findOneAndUpdate(
      {
        _id: claimed._id,
        version,
        closingOperation: token,
        "activeOperations.0": { $exists: false },
      },
      {
        $set: { ...set, updatedAt: new Date().toISOString() },
        $unset: { closingOperation: "" },
        $inc: { version: 1 },
        $push: { events: event },
      },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException(
        "La obra cambió durante el cierre. Reintenta la comprobación.",
      );
    return this.crm.view(saved);
  }
}
