import { ConflictException, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "../database/database.module";
import { InventoryService } from "./inventory.service";
import type { SupplyDocument, SupplyOperation } from "./supply-record";
import { CrmEvents } from "../crm/crm.events";
export function stableOperation(value: string) {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
type Line = { materialId: string; quantity: number };
type Allocation = Line & {
  requestId: string;
  version: number;
  operation: SupplyOperation;
};
type Batch = {
  _id: string;
  workId: string;
  attempt: string;
  status: "preparing" | "ready" | "completed" | "aborted";
  allocations: Allocation[];
  lines: Line[];
};
const milli = (n: number) => Math.round(n * 1000);
@Injectable()
export class SupplyDispatches {
  constructor(
    private readonly db: Database,
    private readonly inventory: InventoryService,
    private readonly events: CrmEvents,
  ) {}
  private get batches() {
    return this.db.db.collection<Batch>("supply_dispatches");
  }
  private get requests() {
    return this.db.db.collection<SupplyDocument>("supply_requests");
  }
  async prepare(
    guideId: string,
    workId: string,
    lines: Line[],
    actor: string,
    targetId?: string,
  ): Promise<Batch> {
    let batch = await this.batches.findOne({ _id: guideId });
    const target = targetId
      ? await this.requests.findOne({ _id: new ObjectId(targetId) })
      : null;
    if (batch && ["ready", "completed"].includes(batch.status)) {
      if (
        targetId &&
        !batch.allocations.some(
          (a) =>
            a.requestId === targetId &&
            target?.operations.some(
              (op) => op.operationId === a.operation.operationId,
            ),
        )
      )
        throw new ConflictException(
          "La solicitud no pertenece a esta entrega.",
        );
      return batch;
    }
    if (
      targetId &&
      (!target?.pending ||
        target.pending.action !== "deliver" ||
        target.pending.guideId !== guideId)
    )
      throw new ConflictException("Reabre la entrega desde su solicitud.");
    if (
      batch?.status === "aborted" &&
      target &&
      batch.attempt === target.pending?.operationId
    )
      throw new ConflictException(
        "La preparación cambió. Registra una nueva entrega.",
      );
    if (!batch || batch.status === "aborted") {
      const attempt = target?.pending?.operationId || randomUUID();
      const rows = await this.requests
        .find({
          workId,
          cancelled: false,
          reserved: { $gt: 0 },
          materialId: { $in: lines.map((line) => line.materialId) },
          $or: [
            { pending: { $exists: false } },
            ...(targetId ? [{ _id: new ObjectId(targetId) }] : []),
          ],
        })
        .sort({ neededBy: 1, createdAt: 1, _id: 1 })
        .toArray();
      if (target)
        rows.sort(
          (a, b) =>
            Number(String(b._id) === targetId) -
            Number(String(a._id) === targetId),
        );
      const allocations: Allocation[] = [];
      for (const line of lines) {
        let remaining = milli(line.quantity);
        for (const row of rows.filter(
          (row) => row.materialId === line.materialId,
        )) {
          const own = String(row._id) === targetId;
          const taken = own
            ? milli(target!.pending!.quantity)
            : Math.min(remaining, milli(row.reserved));
          if (taken > remaining || taken > milli(row.reserved))
            throw new ConflictException(
              "La reserva cambió. Revisa las cantidades de la guía.",
            );
          if (!taken) continue;
          const operation: SupplyOperation = own
            ? target!.pending!
            : {
                operationId: stableOperation(`${attempt}:${row._id}`),
                version: row.version,
                action: "deliver",
                quantity: taken / 1000,
                guideId,
                note: "Salida conjunta con guía",
                actor,
                at: new Date().toISOString(),
                completed: false,
              };
          allocations.push({
            materialId: line.materialId,
            quantity: taken / 1000,
            requestId: String(row._id),
            version: row.version,
            operation,
          });
          remaining -= taken;
        }
        const material = await this.inventory.detail(line.materialId);
        if (remaining > milli(material.available || 0))
          throw new ConflictException(
            `No hay material libre suficiente de ${material.name}. Revisa todas las reservas de la guía.`,
          );
      }
      if (
        (targetId || allocations.length) &&
        lines.some(
          (line) =>
            milli(line.quantity) !==
            allocations
              .filter((a) => a.materialId === line.materialId)
              .reduce((sum, a) => sum + milli(a.quantity), 0),
        )
      )
        throw new ConflictException(
          "Reserva todos los materiales y cantidades de la guía antes de confirmar esta entrega.",
        );
      if (targetId && !allocations.some((a) => a.requestId === targetId))
        throw new ConflictException("La guía no incluye esta solicitud.");
      const plan: Batch = {
        _id: guideId,
        workId,
        attempt,
        status: "preparing",
        allocations,
        lines,
      };
      if (batch)
        batch = await this.batches.findOneAndUpdate(
          { _id: guideId, status: "aborted", attempt: batch.attempt },
          { $set: plan },
          { returnDocument: "after" },
        );
      else
        batch = await this.batches.findOneAndUpdate(
          { _id: guideId },
          { $setOnInsert: plan },
          { upsert: true, returnDocument: "after" },
        );
      if (!batch)
        throw new ConflictException(
          "La guía cambió. Reintenta la preparación.",
        );
    }
    if (
      target &&
      batch.attempt !== target.pending!.operationId &&
      !batch.allocations.some(
        (a) =>
          a.requestId === targetId &&
          a.operation.operationId === target.pending!.operationId,
      )
    )
      throw new ConflictException(
        "La guía ya se está entregando desde otra solicitud.",
      );
    if (batch.status === "completed" || batch.status === "ready") return batch;
    if (batch.status !== "preparing")
      throw new ConflictException(
        "Reabre la entrega para prepararla otra vez.",
      );
    try {
      for (const allocation of batch.allocations) {
        const row = await this.requests.findOne({
          _id: new ObjectId(allocation.requestId),
        });
        if (row?.pending?.operationId === allocation.operation.operationId)
          continue;
        const saved = await this.requests.updateOne(
          {
            _id: new ObjectId(allocation.requestId),
            version: allocation.version,
            pending: { $exists: false },
          },
          {
            $set: { pending: allocation.operation },
            $push: { operations: allocation.operation },
            $inc: { version: 1 },
          },
        );
        if (!saved.modifiedCount)
          throw new ConflictException(
            "Otra persona cambió una solicitud de esta guía. Reabre la entrega.",
          );
      }
      const ready = await this.batches.findOneAndUpdate(
        { _id: guideId, attempt: batch.attempt, status: "preparing" },
        { $set: { status: "ready" } },
        { returnDocument: "after" },
      );
      const latest =
        ready ||
        (await this.batches.findOne({ _id: guideId, attempt: batch.attempt }));
      if (!latest || !["ready", "completed"].includes(latest.status))
        throw new ConflictException(
          "La preparación fue descartada. Reabre la entrega.",
        );
      return latest;
    } catch (error) {
      if (error instanceof ConflictException) await this.abort(batch);
      throw error;
    }
  }
  private async abort(batch: Batch) {
    const aborted = await this.batches.updateOne(
      { _id: batch._id, attempt: batch.attempt, status: "preparing" },
      { $set: { status: "aborted" } },
    );
    const latest = await this.batches.findOne({
      _id: batch._id,
      attempt: batch.attempt,
    });
    if (!aborted.modifiedCount && latest?.status !== "aborted") return;
    for (const a of batch.allocations) {
      // Fence even rows not locked yet; a delayed preparer cannot acquire them.
      await this.requests.updateOne(
        {
          _id: new ObjectId(a.requestId),
          version: a.version,
          pending: { $exists: false },
        },
        { $inc: { version: 1 } },
      );
      await this.requests.updateOne(
        {
          _id: new ObjectId(a.requestId),
          "pending.operationId": a.operation.operationId,
        },
        {
          $unset: { pending: "" },
          $set: {
            "operations.$[op].completed": true,
            "operations.$[op].failed": true,
          },
          $inc: { version: 1 },
        },
        { arrayFilters: [{ "op.operationId": a.operation.operationId }] },
      );
    }
  }
  pieces(batch: Batch) {
    return batch.lines.flatMap((line) => {
      const allocations = batch.allocations.filter(
        (a) => a.materialId === line.materialId,
      );
      const free =
        milli(line.quantity) -
        allocations.reduce((sum, a) => sum + milli(a.quantity), 0);
      return [
        ...allocations.map((a) => ({
          ...a,
          reservationKey: a.requestId,
          operationId: stableOperation(
            `dispatch:${batch._id}:${line.materialId}:${a.requestId}`,
          ),
        })),
        ...(free
          ? [
              {
                ...line,
                quantity: free / 1000,
                reservationKey: undefined,
                operationId: stableOperation(
                  `dispatch:${batch._id}:${line.materialId}`,
                ),
              },
            ]
          : []),
      ];
    });
  }
  async cancelPreparation(
    guideId: string,
    requestId: string,
    operation: SupplyOperation,
    workId: string,
  ) {
    // A v54 delivery can have a stock effect without a batch. Check both the
    // durable outbox and ledger; recheck the ledger if a concurrent drain ran.
    if (
      (await this.inventory.ledger.findOne({ dispatchId: guideId })) ||
      (await this.inventory.materials.findOne({
        "pending.dispatchId": guideId,
      })) ||
      (await this.inventory.ledger.findOne({ dispatchId: guideId }))
    )
      throw new ConflictException(
        "La guía ya tiene movimientos. Reintenta su confirmación.",
      );
    let batch = await this.batches.findOne({ _id: guideId });
    if (!batch)
      batch = await this.batches.findOneAndUpdate(
        { _id: guideId },
        {
          $setOnInsert: {
            _id: guideId,
            workId,
            attempt: operation.operationId,
            status: "aborted",
            allocations: [],
            lines: [],
          },
        },
        { upsert: true, returnDocument: "after" },
      );
    if (batch!.status === "preparing") await this.abort(batch!);
    const latest = await this.batches.findOne({ _id: guideId });
    if (latest?.status !== "aborted")
      throw new ConflictException(
        "La salida ya está preparada o tiene movimientos. Reinténtala para completar su confirmación.",
      );
    await this.requests.updateOne(
      {
        _id: new ObjectId(requestId),
        "pending.operationId": operation.operationId,
      },
      {
        $unset: { pending: "" },
        $set: {
          "operations.$[op].completed": true,
          "operations.$[op].failed": true,
        },
        $inc: { version: 1 },
      },
      { arrayFilters: [{ "op.operationId": operation.operationId }] },
    );
    // Fence every preparer that read this guide before the cancellation.
    await this.db.db
      .collection("dispatches")
      .updateOne(
        { _id: new ObjectId(guideId), departedAt: { $exists: false } },
        { $inc: { departureEpoch: 1 }, $unset: { departureSource: "" } },
      );
    this.events.emit("supplies");
  }
  async recoverLegacy(guideId: string, workId: string, requestId?: string) {
    if (!requestId || (await this.batches.findOne({ _id: guideId }))) return;
    const row = await this.requests.findOne({
      _id: new ObjectId(requestId),
      workId,
    });
    const op = row?.pending;
    if (!row || !op || op.action !== "deliver" || op.guideId !== guideId)
      return;
    const proof = await this.inventory.ledger.findOne({
      dispatchId: guideId,
      reservationKey: requestId,
      leadId: workId,
      materialId: row.materialId,
    });
    if (!proof || milli(proof.quantity) !== milli(op.quantity))
      throw new ConflictException("Revisa el movimiento previo de esta guía.");
    const plan: Batch = {
      _id: guideId,
      workId,
      attempt: op.operationId,
      status: "ready",
      lines: [{ materialId: row.materialId, quantity: op.quantity }],
      allocations: [
        {
          materialId: row.materialId,
          quantity: op.quantity,
          requestId,
          version: row.version,
          operation: op,
        },
      ],
    };
    const batch = await this.batches.findOneAndUpdate(
      { _id: guideId },
      { $setOnInsert: plan },
      { upsert: true, returnDocument: "after" },
    );
    await this.complete(batch!);
  }
  async deliveryAttempt(guideId: string, requestId: string) {
    const row = await this.requests.findOne({ _id: new ObjectId(requestId) });
    if (row?.pending?.action === "deliver" && row.pending.guideId === guideId)
      return row.pending.operationId;
    const batch = await this.batches.findOne({
      _id: guideId,
      status: { $in: ["ready", "completed"] },
    });
    return batch?.allocations.find(
      (a) =>
        a.requestId === requestId &&
        row?.operations.some(
          (op) => op.operationId === a.operation.operationId,
        ),
    )?.operation.operationId;
  }
  async isLinked(guideId: string, requestId: string) {
    return !!(await this.batches.findOne({
      _id: guideId,
      "allocations.requestId": requestId,
      status: { $in: ["preparing", "ready", "completed"] },
    }));
  }
  async release(guideId: string) {
    const batch = await this.batches.findOne({
      _id: guideId,
      status: "completed",
    });
    if (!batch) return;
    for (const a of batch.allocations)
      await this.requests.updateOne(
        {
          _id: new ObjectId(a.requestId),
          "pending.operationId": a.operation.operationId,
        },
        { $unset: { pending: "" } },
      );
    this.events.emit("supplies");
  }
  async complete(batch: Batch) {
    for (const a of batch.allocations) {
      const row = await this.requests.findOne({
        _id: new ObjectId(a.requestId),
      });
      if (!row)
        throw new ConflictException("Solicitud de entrega no encontrada.");
      await this.requests.updateOne(
        {
          _id: new ObjectId(a.requestId),
          "pending.operationId": a.operation.operationId,
          operations: {
            $elemMatch: {
              operationId: a.operation.operationId,
              completed: false,
            },
          },
        },
        {
          $inc: { version: 1 },
          $set: {
            delivered: (milli(row.delivered) + milli(a.quantity)) / 1000,
            reserved: (milli(row.reserved) - milli(a.quantity)) / 1000,
            "operations.$[op].completed": true,
          },
        },
        { arrayFilters: [{ "op.operationId": a.operation.operationId }] },
      );
    }
    await this.batches.updateOne(
      { _id: batch._id, attempt: batch.attempt, status: "ready" },
      { $set: { status: "completed" } },
    );
    this.events.emit("supplies");
  }
}
