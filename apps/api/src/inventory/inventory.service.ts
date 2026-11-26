import { CrmEvents } from "../crm/crm.events";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import {
  materialSchema,
  materialDimensionsUpdate,
  movementSchema,
  type Material,
  type Movement,
  stockCount,
  inventoryImport,
} from "@veca/content";
import { Database } from "../database/database.module";
import { parse } from "../common/validation";
import { CrmRepository } from "../crm/crm.repository";
type StoredMovement = Movement & {
  _id: string;
  fingerprint: string;
  returnedUse?: number;
  reservationKey?: string;
};
type Stock = { quantity: number; valued: number; cents: number };
type StockOrigin = {
  unitCents?: number;
  purchaseId?: string;
  dispatchId?: string;
  reservationKey?: string;
  count?: { version: number; counted: number };
};
const emptyStock: Stock = { quantity: 0, valued: 0, cents: 0 };
const ratio = (amount: number, numerator: number, divisor: number) =>
  Number(
    (BigInt(amount) * BigInt(numerator) + BigInt(divisor) / 2n) /
      BigInt(divisor),
  );
const stock = (quantity: number, unitCents?: number): Stock => ({
  quantity,
  valued: unitCents === undefined ? 0 : quantity,
  cents: ratio(quantity, unitCents ?? 0, 1000),
});
const combine = (a: Stock, b: Stock): Stock => ({
  quantity: a.quantity + b.quantity,
  valued: a.valued + b.valued,
  cents: a.cents + b.cents,
});
function withdraw(from: Stock, quantity: number) {
  if (quantity === from.quantity) return { taken: from, remaining: emptyStock };
  if (!quantity) return { taken: emptyStock, remaining: from };
  const valued = ratio(from.valued, quantity, from.quantity);
  const cents = from.valued ? ratio(from.cents, valued, from.valued) : 0;
  return {
    taken: { quantity, valued, cents },
    remaining: {
      quantity: from.quantity - quantity,
      valued: from.valued - valued,
      cents: from.cents - cents,
    },
  };
}
type MaterialDocument = Omit<
  Material,
  "id" | "balance" | "minimum" | "unitCostCents"
> & {
  _id: ObjectId;
  reservations?: Record<string, { workId: string; quantity: number }>;
  reservationRevisions?: Record<string, number>;
  balanceMilli: number;
  minimumMilli: number;
  pending: StoredMovement[];
  stockValue?: Pick<Stock, "valued" | "cents">;
  workStock?: Record<string, Stock>;
};
@Injectable()
export class InventoryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly database: Database,
    private readonly leads: CrmRepository,
    private readonly events: CrmEvents,
  ) {}
  get materials() {
    return this.database.db.collection<MaterialDocument>("inventory_materials");
  }
  get ledger() {
    return this.database.db.collection<StoredMovement>("inventory_movements");
  }
  async onApplicationBootstrap() {
    await this.flush().catch(() => {});
    this.timer = setInterval(() => void this.flush().catch(() => {}), 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  id(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException("Material no encontrado.");
    return new ObjectId(id);
  }
  view(doc: MaterialDocument): Material {
    const {
      _id,
      balanceMilli,
      minimumMilli,
      pending,
      stockValue,
      workStock,
      reservations,
      reservationRevisions,
      ...rest
    } = doc;
    return {
      ...rest,
      id: String(_id),
      balance: balanceMilli / 1000,
      reserved:
        Object.values(reservations || {}).reduce(
          (sum, row) => sum + row.quantity,
          0,
        ) / 1000,
      available:
        (balanceMilli -
          Object.values(reservations || {}).reduce(
            (sum, row) => sum + row.quantity,
            0,
          )) /
        1000,
      minimum: minimumMilli / 1000,
      unitCostCents:
        balanceMilli > 0 && stockValue?.valued === balanceMilli
          ? Math.round((stockValue.cents * 1000) / balanceMilli)
          : undefined,
    };
  }
  async reserve(
    materialId: string,
    key: string,
    workId: string,
    quantity: number,
    revision: number,
  ) {
    const id = this.id(materialId);
    const target = Math.round(quantity * 1000);
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await this.materials.findOne({ _id: id });
      if (!doc) throw new NotFoundException("Material no encontrado.");
      // Retain the revision after release so a delayed retry cannot recreate
      // a reservation already delivered or cancelled by a later operation.
      if ((doc.reservationRevisions?.[key] || 0) >= revision) return;
      const reservations = { ...doc.reservations };
      const previous = reservations[key]?.quantity || 0;
      if (reservations[key] && reservations[key].workId !== workId)
        throw new ConflictException();
      const reserved = Object.values(reservations).reduce(
        (sum, row) => sum + row.quantity,
        0,
      );
      if (doc.balanceMilli - reserved + previous < target)
        throw new ConflictException(
          "No hay existencias disponibles para esa reserva.",
        );
      if (target) reservations[key] = { workId, quantity: target };
      else delete reservations[key];
      const changed = await this.materials.updateOne(
        { _id: id, version: doc.version },
        {
          $set: { reservations, [`reservationRevisions.${key}`]: revision },
          $inc: { version: 1 },
        },
      );
      if (changed.modifiedCount) {
        this.events.emit("inventory");
        return;
      }
    }
    throw new ConflictException(
      "Las existencias cambiaron. Revisa la reserva.",
    );
  }

  /** Stock and its pending audit event commit together in one MongoDB document.
   * The outbox is drained idempotently to the append-only ledger. A crash between
   * writes cannot lose a movement or apply its stock change a second time. */
  async flush(materialId?: ObjectId) {
    const docs = await this.materials
      .find({
        ...(materialId ? { _id: materialId } : {}),
        "pending.0": { $exists: true },
      })
      .limit(100)
      .toArray();
    for (const doc of docs)
      for (const event of doc.pending) {
        await this.ledger.updateOne(
          { _id: event._id },
          { $setOnInsert: event },
          { upsert: true },
        );
        await this.materials.updateOne(
          { _id: doc._id },
          { $pull: { pending: { _id: event._id } } },
        );
      }
  }
  async list(search = "") {
    const safe = search
      .trim()
      .slice(0, 80)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = safe
      ? {
          $or: [
            { name: { $regex: safe, $options: "i" } },
            { sku: { $regex: safe, $options: "i" } },
          ],
        }
      : {};
    const docs = await this.materials
      .find(filter)
      .sort({ name: 1 })
      .limit(1000)
      .toArray();
    return docs.map((d) => this.view(d));
  }
  async detail(id: string) {
    const row = await this.materials.findOne({ _id: this.id(id) });
    if (!row) throw new NotFoundException("Material no encontrado.");
    return this.view(row);
  }
  async updateDimensions(id: string, input: unknown) {
    const { version, dimensions } = parse(materialDimensionsUpdate, input);
    const material = await this.materials.findOneAndUpdate(
      { _id: this.id(id), version },
      {
        $set: {
          updatedAt: new Date().toISOString(),
          ...(dimensions && { dimensions }),
        },
        ...(!dimensions && { $unset: { dimensions: "" } }),
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!material)
      throw new ConflictException(
        "El material cambió. Vuelve a abrirlo para editar las medidas.",
      );
    this.events.emit("inventory");
    return this.view(material);
  }
  async create(input: unknown) {
    const data = parse(materialSchema, input);
    const { minimum, ...fields } = data;
    const now = new Date().toISOString();
    const doc: MaterialDocument = {
      ...fields,
      _id: new ObjectId(),
      minimumMilli: Math.round(minimum * 1000),
      balanceMilli: 0,
      pending: [],
      version: 1,
      updatedAt: now,
    };
    try {
      await this.materials.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new ConflictException("Ya existe un material con ese código.");
      throw e;
    }
    this.events.emit("inventory");
    return this.view(doc);
  }
  private async readImport(input: unknown) {
    const { materials } = parse(inventoryImport, input);
    const codes = materials.map((row) => row.sku);
    if (new Set(codes).size !== codes.length)
      throw new BadRequestException("El archivo contiene códigos repetidos.");
    const existing = await this.materials
      .find({ sku: { $in: codes } })
      .toArray();
    const byCode = new Map(existing.map((row) => [row.sku, row]));
    return { materials, byCode };
  }
  async previewImport(input: unknown) {
    const { materials, byCode } = await this.readImport(input);
    return materials.map((row) => {
      const current = byCode.get(row.sku);
      return { sku: row.sku, current: current ? this.view(current) : null };
    });
  }
  async importMaterials(input: unknown) {
    const { materials, byCode } = await this.readImport(input);
    for (const row of materials) {
      const current = byCode.get(row.sku);
      if (current && current.unit !== row.unit)
        throw new BadRequestException(
          `La unidad de ${row.sku} debe coincidir con la del catálogo.`,
        );
    }
    const now = new Date().toISOString();
    const result = await this.materials
      .bulkWrite(
        materials.map(({ minimum, ...row }) => ({
          updateOne: {
            filter: { sku: row.sku, unit: row.unit },
            update: {
              $set: {
                ...row,
                minimumMilli: Math.round(minimum * 1000),
                updatedAt: now,
              },
              $setOnInsert: { balanceMilli: 0, pending: [] },
              $inc: { version: 1 },
            },
            upsert: true,
          },
        })),
      )
      .catch((error) => {
        if ((error as { code?: number }).code === 11000)
          throw new ConflictException(
            "El catálogo cambió durante la carga. Revisa las unidades y vuelve a importar.",
          );
        throw error;
      });
    this.events.emit("inventory");
    return { created: result.upsertedCount, updated: result.matchedCount };
  }

  async count(materialId: string, input: unknown, actor: string) {
    const { operationId, version, counted, reason, unitCents } = parse(
      stockCount,
      input,
    );
    return this.move(
      materialId,
      { operationId, kind: "receipt", quantity: 1, leadId: null, reason },
      actor,
      {
        count: { version, counted },
        unitCents,
      },
    );
  }

  async move(
    materialId: string,
    input: unknown,
    actor: string,
    origin: StockOrigin = {},
  ) {
    const data = parse(movementSchema, input);
    const id = this.id(materialId);
    materialId = String(id);
    const key = `${materialId}:${data.operationId}`;
    const fingerprint = JSON.stringify(
      Object.keys(origin).length ? { data, origin } : data,
    );
    await this.flush(id);
    const readPrevious = async () => {
      const entry = await this.ledger.findOne({ _id: key });
      if (entry && entry.fingerprint !== fingerprint)
        throw new ConflictException(
          "La referencia de este movimiento ya fue utilizada con otros datos.",
        );
      return entry;
    };
    const previous = await readPrevious();
    if (previous) return previous;
    if ((data.kind !== "receipt" || origin.dispatchId) && !data.leadId)
      throw new BadRequestException("Asocia el movimiento a una obra.");
    if (data.leadId && !origin.purchaseId) {
      const lead = await this.leads.get(data.leadId);
      const stages = origin.dispatchId
        ? ["coordination", "execution", "completed"]
        : ["execution", "completed"];
      if (!stages.includes(lead.stage))
        throw new BadRequestException(
          "Revisa la etapa de la obra antes de mover sus materiales.",
        );
    }
    const doc = await this.materials.findOne({ _id: id });
    if (!doc) throw new NotFoundException("Material no encontrado.");
    const pending = doc.pending.find((entry) => entry._id === key);
    if (pending) {
      await this.flush(id);
      return readPrevious();
    }
    if (origin.count && origin.count.version !== doc.version)
      throw new ConflictException(
        "El saldo cambió. Vuelve a abrir el conteo antes de confirmarlo.",
      );

    const milli = Math.round(data.quantity * 1000);
    let warehouse: Stock = {
      ...emptyStock,
      ...doc.stockValue,
      quantity: doc.balanceMilli,
    };
    const workId = data.leadId || "";
    const workStock = { ...doc.workStock };
    let held = workStock[workId] || emptyStock;
    let measured = emptyStock;
    let consumed = emptyStock;
    let kind: Movement["kind"] = data.kind;
    let reportedQuantity = milli;
    const reservations = { ...doc.reservations };
    const reserved = Object.values(reservations).reduce(
      (sum, row) => sum + row.quantity,
      0,
    );
    const own = origin.reservationKey
      ? reservations[origin.reservationKey]
      : undefined;
    if (
      origin.reservationKey &&
      (!own || own.workId !== workId || own.quantity < milli)
    )
      throw new ConflictException(
        "La reserva de esta solicitud ya no cubre la salida.",
      );
    const available = warehouse.quantity - reserved + (own?.quantity || 0);

    if (origin.count) {
      kind = "count";
      const counted = Math.round(origin.count.counted * 1000);
      if (counted < reserved)
        throw new ConflictException(
          "Libera las reservas antes de ajustar por debajo de lo comprometido.",
        );
      reportedQuantity = Math.abs(counted - warehouse.quantity);
      if (counted < warehouse.quantity)
        warehouse = withdraw(warehouse, warehouse.quantity - counted).remaining;
      else
        warehouse = combine(
          warehouse,
          stock(counted - warehouse.quantity, origin.unitCents),
        );
      if (origin.unitCents !== undefined) {
        warehouse = combine(
          { ...warehouse, quantity: warehouse.valued },
          stock(warehouse.quantity - warehouse.valued, origin.unitCents),
        );
      }
    } else if (origin.dispatchId || data.kind === "consumption") {
      const fromWork = origin.dispatchId ? 0 : Math.min(held.quantity, milli);
      if (available < milli - fromWork)
        throw new ConflictException("Stock insuficiente para este movimiento.");
      const workWithdrawal = withdraw(held, fromWork);
      const warehouseWithdrawal = withdraw(warehouse, milli - fromWork);
      held = workWithdrawal.remaining;
      warehouse = warehouseWithdrawal.remaining;
      measured = combine(workWithdrawal.taken, warehouseWithdrawal.taken);
      if (origin.dispatchId) {
        if (origin.reservationKey && own) {
          if (own.quantity === milli)
            delete reservations[origin.reservationKey];
          else
            reservations[origin.reservationKey] = {
              ...own,
              quantity: own.quantity - milli,
            };
        }
        kind = "dispatch";
        held = combine(held, measured);
      } else {
        consumed = measured;
      }
    } else if (data.kind === "return") {
      const heldReturn = withdraw(held, Math.min(held.quantity, milli));
      held = heldReturn.remaining;
      const remainder = milli - heldReturn.taken.quantity;
      if (remainder) {
        await this.flush(id);
        const history = await this.ledger
          .aggregate<{ quantity: number; valued: number; cents: number }>([
            {
              $match: {
                materialId,
                leadId: workId,
                kind: { $in: ["consumption", "return"] },
              },
            },
            {
              $group: {
                _id: null,
                quantity: {
                  $sum: {
                    $cond: [
                      { $eq: ["$kind", "consumption"] },
                      "$quantity",
                      {
                        $multiply: [
                          -1,
                          { $ifNull: ["$returnedUse", "$quantity"] },
                        ],
                      },
                    ],
                  },
                },
                valued: {
                  $sum: {
                    $subtract: [
                      {
                        $cond: [
                          { $eq: ["$kind", "consumption"] },
                          "$quantity",
                          {
                            $multiply: [
                              -1,
                              { $ifNull: ["$returnedUse", "$quantity"] },
                            ],
                          },
                        ],
                      },
                      {
                        $ifNull: [
                          "$unvaluedQuantity",
                          {
                            $cond: [
                              { $eq: ["$kind", "consumption"] },
                              "$quantity",
                              {
                                $multiply: [
                                  -1,
                                  { $ifNull: ["$returnedUse", "$quantity"] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
                cents: { $sum: "$costCents" },
              },
            },
          ])
          .next();
        const quantity = Math.max(
          0,
          Math.round((history?.quantity ?? 0) * 1000),
        );
        if (quantity < remainder)
          throw new BadRequestException(
            "La devolución supera los materiales entregados o consumidos por esta obra.",
          );
        const valued = Math.max(
          0,
          Math.min(quantity, Math.round((history?.valued ?? 0) * 1000)),
        );
        const returned = withdraw(
          { quantity, valued, cents: Math.max(0, history?.cents ?? 0) },
          remainder,
        ).taken;
        consumed = {
          quantity: -returned.quantity,
          valued: -returned.valued,
          cents: -returned.cents,
        };
      }
      measured = combine(heldReturn.taken, {
        quantity: -consumed.quantity,
        valued: -consumed.valued,
        cents: -consumed.cents,
      });
      warehouse = combine(warehouse, measured);
    } else {
      measured = stock(milli, origin.unitCents);
      warehouse = combine(warehouse, measured);
    }
    if (workId) {
      if (held.quantity) workStock[workId] = held;
      else delete workStock[workId];
    }
    const event: StoredMovement = {
      _id: key,
      id: key,
      fingerprint,
      materialId,
      materialName: doc.name,
      unit: doc.unit,
      leadId: data.leadId,
      kind,
      quantity: reportedQuantity / 1000,
      reason: data.reason,
      actor,
      at: new Date().toISOString(),
      balanceAfter: warehouse.quantity / 1000,
      costCents: consumed.cents,
      unvaluedQuantity: (consumed.quantity - consumed.valued) / 1000,
      valuedQuantity: consumed.valued / 1000,
      ...(origin.purchaseId ? { purchaseId: origin.purchaseId } : {}),
      ...(origin.reservationKey
        ? { reservationKey: origin.reservationKey }
        : {}),
      ...(origin.dispatchId ? { dispatchId: origin.dispatchId } : {}),
      ...(origin.count
        ? {
            counted: origin.count.counted,
            previousBalance: doc.balanceMilli / 1000,
          }
        : {}),
      ...(kind === "return" ? { returnedUse: -consumed.quantity / 1000 } : {}),
    };
    const result = await this.materials.updateOne(
      { _id: id, version: doc.version, "pending._id": { $ne: key } },
      {
        $inc: { version: 1 },
        $set: {
          balanceMilli: warehouse.quantity,
          stockValue: { valued: warehouse.valued, cents: warehouse.cents },
          workStock,
          reservations,
          updatedAt: event.at,
        },
        $push: { pending: event },
      },
    );
    if (!result.modifiedCount) {
      await this.flush(id);
      const repeated = await readPrevious();
      if (repeated) return repeated;
      throw new ConflictException(
        "El saldo cambió. Vuelve a revisar el movimiento.",
      );
    }
    this.events.emit("inventory");
    await this.flush(id);
    return event;
  }

  async movements(leadId?: string, materialId?: string, page = 1) {
    if (leadId) await this.leads.get(leadId);
    await this.flush();
    const filter = {
      ...(leadId ? { leadId } : {}),
      ...(materialId ? { materialId } : {}),
    };
    const docs = await this.ledger
      .find(filter)
      .sort({ at: -1, _id: -1 })
      .skip((Math.max(1, page) - 1) * 100)
      .limit(100)
      .toArray();
    return docs.map(({ _id, fingerprint, ...rest }) => rest);
  }
}
