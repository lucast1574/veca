import { createHash } from "node:crypto";
import { WorkGate } from "../crm/work-gate.service";
import { literalSearch } from "../common/literal-search";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId, type Filter } from "mongodb";
import {
  equipmentInput,
  equipmentAction,
  isDemoLead,
  purchaseInput,
  purchaseReceipt,
  purchaseRequest,
  workPlanInput,
  type Equipment,
  type Purchase,
  type WorkSupply,
  type WorkPlan,
} from "@veca/content";
import { parse } from "../common/validation";
import { CrmRepository } from "../crm/crm.repository";
import { Database } from "../database/database.module";
import { InventoryService } from "./inventory.service";

type PurchaseRecord = Omit<Purchase, "id" | "status"> & {
  _id: ObjectId;
  version: number;
  cancelled?: boolean;
  requestedOnly?: boolean;
  requestedAt?: string;
  requestedBy?: string;
};
type EquipmentRecord = Omit<Equipment, "id" | "events"> & {
  _id: ObjectId;
  events: (Equipment["events"][number] & {
    operationId?: string;
    requestHash?: string;
  })[];
};
type PlanRecord = WorkPlan & { _id: ObjectId };
const emptyPlan: WorkPlan = {
  revision: 0,
  budgetCents: 0,
  materials: [],
  equipment: [],
};
const safeId = (value: string) => {
  if (!/^[a-f\d]{24}$/i.test(value))
    throw new NotFoundException("Registro no encontrado.");
  return new ObjectId(value);
};
const milli = (value: number) => Math.round(value * 1000);
function purchaseView({
  _id,
  version,
  cancelled,
  requestedOnly,
  ...row
}: PurchaseRecord): Purchase {
  const status = cancelled
    ? "cancelled"
    : requestedOnly
      ? "requested"
      : row.items.every((item) => milli(item.received) === milli(item.ordered))
        ? "received"
        : row.items.some((item) => item.received)
          ? "partial"
          : "open";
  return { ...row, id: String(_id), status };
}
const equipmentView = ({ _id, ...row }: EquipmentRecord): Equipment => ({
  id: String(_id),
  ...row,
  events: row.events.map(({ operationId, requestHash, ...event }) => event),
});

@Injectable()
export class WarehouseService {
  constructor(
    private readonly db: Database,
    private readonly crm: CrmRepository,
    private readonly inventory: InventoryService,
    private readonly gate: WorkGate,
  ) {}
  private get orders() {
    return this.db.db.collection<PurchaseRecord>("warehouse_purchases");
  }
  private get equipment() {
    return this.db.db.collection<EquipmentRecord>("warehouse_equipment");
  }
  private get plans() {
    return this.db.db.collection<PlanRecord>("warehouse_plans");
  }

  async work(id: string) {
    const row = await this.crm.get(String(safeId(id)));
    if (
      isDemoLead(row) ||
      !["coordination", "execution", "completed"].includes(row.stage)
    )
      throw new BadRequestException("Selecciona una obra operativa.");
    return row;
  }

  async works() {
    const rows = await this.crm.collection
      .find({
        stage: { $in: ["coordination", "execution", "completed"] },
        name: { $not: /^\[demo\]/i },
        email: { $not: /\.invalid$/i },
      })
      .project({ name: 1, stage: 1 })
      .sort({ updatedAt: -1 })
      .limit(1000)
      .toArray();
    return rows.map((row) => ({
      id: String(row._id),
      name: String(row.name),
      stage: String(row.stage),
    }));
  }

  async listPurchases(page: number, search = "", status?: Purchase["status"]) {
    const safe = literalSearch(search);
    const query: Filter<PurchaseRecord> = safe
      ? {
          $or: [
            "supplier",
            "supplierRuc",
            "workName",
            "items.sku",
            "items.name",
            "receipts.reference",
          ].map((field) => ({
            [field]: { $regex: safe, $options: "i" },
          })),
        }
      : {};
    if (status === "cancelled") query.cancelled = true;
    if (status === "requested") {
      query.cancelled = { $ne: true };
      query.requestedOnly = true;
    }
    if (status === "open" || status === "partial" || status === "received") {
      query.cancelled = { $ne: true };
      query.requestedOnly = { $ne: true };
      const everyReceived = {
        $allElementsTrue: [
          {
            $map: {
              input: "$items",
              as: "item",
              in: {
                $eq: [
                  { $round: [{ $multiply: ["$$item.received", 1000] }, 0] },
                  { $round: [{ $multiply: ["$$item.ordered", 1000] }, 0] },
                ],
              },
            },
          },
        ],
      };
      const anyReceived = {
        $anyElementTrue: [
          {
            $map: {
              input: "$items",
              as: "item",
              in: { $gt: ["$$item.received", 0] },
            },
          },
        ],
      };
      query.$expr =
        status === "received"
          ? everyReceived
          : {
              $and: [
                { $not: [everyReceived] },
                status === "partial" ? anyReceived : { $not: [anyReceived] },
              ],
            };
    }
    const rows = await this.orders
      .find(query)
      .sort({ _id: -1 })
      .skip((page - 1) * 30)
      .limit(31)
      .toArray();
    return {
      items: rows.slice(0, 30).map(purchaseView),
      hasMore: rows.length === 31,
    };
  }

  private async order(id: string) {
    const row = await this.orders.findOne({ _id: safeId(id) });
    if (!row) throw new NotFoundException("Compra no encontrada.");
    return row;
  }

  async purchase(id: string) {
    return purchaseView(await this.order(id));
  }

  async createPurchase(raw: unknown, actor: string) {
    const data = parse(purchaseInput, raw);
    const action = () => this.createPurchaseRecord(data, actor);
    return data.workId
      ? this.gate.run(data.workId, `purchase:${data.id}`, action)
      : action();
  }
  private async createPurchaseRecord(raw: unknown, actor: string) {
    const { id, items, ...data } = parse(purchaseInput, raw);
    const work = data.workId ? await this.work(data.workId) : null;
    const orderItems = await Promise.all(
      items.map(async (item) => {
        const material = await this.inventory.materials.findOne({
          _id: safeId(item.materialId),
        });
        if (!material)
          throw new BadRequestException(
            "Hay un material que no existe en el catálogo.",
          );
        return {
          ...item,
          materialId: String(material._id),
          name: material.name,
          sku: material.sku,
          unit: material.unit,
          received: 0,
        };
      }),
    );
    const row: PurchaseRecord = {
      ...data,
      workId: work ? String(work._id) : "",
      workName: work?.name || "",
      _id: safeId(id),
      items: orderItems,
      receipts: [],
      version: 1,
      actor,
      createdAt: new Date().toISOString(),
    };
    const saved = await this.orders.findOneAndUpdate(
      { _id: row._id },
      { $setOnInsert: row },
      { upsert: true, returnDocument: "after" },
    );
    if (
      !saved ||
      saved.supplier !== row.supplier ||
      saved.supplierRuc !== row.supplierRuc ||
      saved.workId !== row.workId ||
      saved.reason !== row.reason ||
      JSON.stringify(
        saved.items.map(({ received, name, unit, sku, ...item }) => item),
      ) !==
        JSON.stringify(
          row.items.map(({ received, name, unit, sku, ...item }) => item),
        )
    )
      throw new ConflictException("La solicitud ya corresponde a otra compra.");
    return purchaseView(saved);
  }

  async requestPurchase(raw: unknown, actor: string) {
    const data = parse(purchaseRequest, raw);
    const action = () => this.requestPurchaseRecord(data, actor);
    return data.workId
      ? this.gate.run(data.workId, `purchase:${data.id}`, action)
      : action();
  }
  private async requestPurchaseRecord(raw: unknown, actor: string) {
    const input = parse(purchaseRequest, raw);
    const work = await this.work(input.workId);
    if (work.stage === "completed")
      throw new BadRequestException("La obra ya está realizada.");
    const items = await Promise.all(
      input.materials.map(async (item) => {
        const material = await this.inventory.materials.findOne({
          _id: safeId(item.materialId),
        });
        if (!material)
          throw new BadRequestException(
            "Selecciona materiales vigentes del catálogo.",
          );
        return {
          materialId: String(material._id),
          name: material.name,
          sku: material.sku,
          unit: material.unit,
          requested: item.quantity,
          received: 0,
          ordered: 0,
          unitCents: 0,
          reason: input.reason,
        };
      }),
    );
    const at = new Date().toISOString();
    const document: PurchaseRecord = {
      _id: safeId(input.id),
      workId: String(work._id),
      workName: work.name,
      supplier: "",
      supplierRuc: "",
      reason: input.reason,
      items,
      receipts: [],
      createdAt: at,
      actor,
      version: 1,
      requestedOnly: true,
      requestedAt: at,
      requestedBy: actor,
    };
    const row = await this.orders.findOneAndUpdate(
      { _id: document._id },
      { $setOnInsert: document },
      { upsert: true, returnDocument: "after" },
    );
    if (
      !row?.requestedOnly ||
      row.workId !== document.workId ||
      row.reason !== document.reason ||
      JSON.stringify(
        row.items.map((item) => [item.materialId, item.requested]),
      ) !==
        JSON.stringify(
          document.items.map((item) => [item.materialId, item.requested]),
        )
    )
      throw new ConflictException(
        "Esta solicitud ya corresponde a otro registro.",
      );
    return purchaseView(row);
  }

  async orderPurchase(id: string, raw: unknown, actor: string) {
    const input = parse(purchaseInput, raw);
    const row = await this.order(id);
    if (
      input.id.toLowerCase() !== String(row._id) ||
      input.workId.toLowerCase() !== row.workId ||
      input.items.length !== row.items.length
    )
      throw new BadRequestException(
        "La compra debe conservar la obra y los códigos de la solicitud.",
      );
    const items = row.items.map((item) => {
      const line = input.items.find(
        (entry) => entry.materialId.toLowerCase() === item.materialId,
      );
      if (!line || line.requested !== item.requested)
        throw new BadRequestException(
          "Las cantidades solicitadas se conservan en el historial.",
        );
      return {
        ...item,
        ordered: line.ordered,
        unitCents: line.unitCents,
        reason: line.reason,
      };
    });
    if (
      !row.requestedOnly &&
      !row.cancelled &&
      row.requestedAt &&
      row.supplier === input.supplier &&
      row.supplierRuc === input.supplierRuc &&
      row.items.every(
        (item, index) =>
          item.ordered === items[index].ordered &&
          item.unitCents === items[index].unitCents &&
          item.reason === items[index].reason,
      )
    )
      return purchaseView(row);
    const saved = await this.orders.findOneAndUpdate(
      { _id: row._id, requestedOnly: true, cancelled: { $ne: true } },
      {
        $set: {
          supplier: input.supplier,
          supplierRuc: input.supplierRuc,
          items,
          requestedOnly: false,
          actor,
          createdAt: new Date().toISOString(),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException("La solicitud ya fue atendida o cancelada.");
    return purchaseView(saved);
  }

  async cancelPurchase(id: string) {
    const row = await this.order(id);
    if (row.cancelled) return purchaseView(row);
    const result = await this.orders.findOneAndUpdate(
      { _id: row._id, "receipts.0": { $exists: false } },
      { $set: { cancelled: true }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (!result) throw new ConflictException("La compra ya tiene recepciones.");
    return purchaseView(result);
  }

  async receive(id: string, raw: unknown, actor: string) {
    const parsed = parse(purchaseReceipt, raw);
    const data = { ...parsed, materialId: String(safeId(parsed.materialId)) };
    const row = await this.order(id);
    const reserved = row.receipts.find(
      (item) => item.operationId === data.operationId,
    );
    if (
      reserved &&
      (reserved.materialId !== data.materialId ||
        reserved.quantity !== data.quantity ||
        reserved.reference !== data.reference)
    )
      throw new ConflictException(
        "Esta recepción ya se registró con otros datos.",
      );
    if (reserved?.applied) return purchaseView(row);
    const item = row.items.find((line) => line.materialId === data.materialId);
    if (!item || row.cancelled || row.requestedOnly)
      throw new BadRequestException(
        "El material no corresponde a una compra abierta.",
      );
    if (!reserved) {
      const pending = row.receipts.filter(
        (receipt) => !receipt.applied && receipt.materialId === data.materialId,
      );
      const expected =
        milli(item.received) +
        pending.reduce((sum, receipt) => sum + milli(receipt.quantity), 0);
      if (expected + milli(data.quantity) > milli(item.ordered))
        throw new BadRequestException(
          "La recepción supera la cantidad pendiente.",
        );
      const lock = await this.orders.updateOne(
        {
          _id: row._id,
          version: row.version,
          $or: [{ cancelled: { $exists: false } }, { cancelled: false }],
        },
        {
          $push: {
            receipts: {
              ...data,
              actor,
              applied: false,
              at: new Date().toISOString(),
            },
          },
          $inc: { version: 1 },
        },
      );
      if (!lock.modifiedCount)
        throw new ConflictException(
          "La compra cambió. Vuelve a abrirla y verifica las recepciones.",
        );
    }

    await this.inventory.move(
      data.materialId,
      {
        operationId: data.operationId,
        leadId: row.workId || null,
        kind: "receipt",
        quantity: data.quantity,
        reason: `Compra a ${row.supplier} · ${data.reference}`,
      },
      reserved?.actor || actor,
      { purchaseId: String(row._id), unitCents: item.unitCents },
    );

    await this.orders.updateOne(
      {
        _id: row._id,
        receipts: {
          $elemMatch: { operationId: data.operationId, applied: false },
        },
      },
      {
        $set: { "receipts.$[receipt].applied": true },
        $inc: { "items.$[item].received": data.quantity, version: 1 },
      },
      {
        arrayFilters: [
          { "receipt.operationId": data.operationId },
          { "item.materialId": data.materialId },
        ],
      },
    );
    return this.purchase(id);
  }

  async listEquipment() {
    const rows = await this.equipment
      .find()
      .project<EquipmentRecord>({ events: { $slice: -1 } })
      .sort({ code: 1 })
      .limit(1000)
      .toArray();
    return rows.map(equipmentView);
  }

  async equipmentDetail(id: string) {
    const row = await this.equipment.findOne({ _id: safeId(id) });
    if (!row) throw new NotFoundException("Equipo no encontrado.");
    return equipmentView(row);
  }

  async createEquipment(raw: unknown) {
    const { id, ...data } = parse(equipmentInput, raw);
    const row = await this.equipment
      .findOneAndUpdate(
        { _id: safeId(id) },
        { $setOnInsert: { ...data, version: 1, assignment: null, events: [] } },
        { upsert: true, returnDocument: "after" },
      )
      .catch((error) => {
        if ((error as { code?: number }).code === 11000)
          throw new ConflictException("Ya existe un equipo con ese código.");
        throw error;
      });
    if (!row || row.code !== data.code)
      throw new ConflictException("El identificador ya fue utilizado.");
    return equipmentView(row);
  }

  async equipmentAction(id: string, raw: unknown, actor: string) {
    const data = parse(equipmentAction, raw);
    const current = await this.equipmentDetail(id);
    const operation = `equipment:${id}:${data.version}` as const;
    const receipt = (
      await this.equipment.findOne({ _id: safeId(id) })
    )?.events.find((event) => event.operationId === operation);
    if (receipt) {
      if (
        receipt.requestHash !==
        createHash("sha256").update(JSON.stringify(data)).digest("hex")
      )
        throw new ConflictException(
          "La operación ya se registró con otros datos.",
        );
      return receipt.workId
        ? this.gate.run(receipt.workId, operation, async () => current, true)
        : current;
    }
    const workId =
      data.action === "assign" ? data.workId : current.assignment?.workId;
    const action = () => this.applyEquipmentAction(id, data, actor);
    return workId
      ? this.gate.run(
          workId,
          `equipment:${id}:${data.version}`,
          action,
          data.action === "return",
        )
      : action();
  }
  private async applyEquipmentAction(id: string, raw: unknown, actor: string) {
    const input = parse(equipmentAction, raw);
    const row = await this.equipmentDetail(id);
    const at = new Date().toISOString();
    const base = {
      at,
      actor,
      note: input.note,
      operationId: `equipment:${id}:${input.version}`,
      requestHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
    };
    let update: Pick<Equipment, "assignment" | "location" | "condition">;
    let event: EquipmentRecord["events"][number];
    if (input.action === "assign") {
      if (row.assignment || row.condition !== "good")
        throw new ConflictException(
          "El equipo debe estar disponible y operativo.",
        );
      const work = await this.work(input.workId);
      if (work.stage === "completed")
        throw new BadRequestException("La obra ya está realizada.");
      const assignment = {
        workId: String(work._id),
        workName: work.name,
        responsible: input.responsible,
        ...(input.expectedReturn
          ? { expectedReturn: input.expectedReturn }
          : {}),
        at,
      };
      update = { assignment, condition: row.condition, location: row.location };
      event = { ...base, action: input.action, ...assignment };
    } else {
      if (Boolean(row.assignment) !== (input.action === "return"))
        throw new ConflictException(
          "Revisa la asignación actual de este equipo.",
        );
      update = {
        assignment: null,
        condition: input.condition,
        location: input.location,
      };
      event = { ...row.assignment, ...base, ...update, action: input.action };
    }
    const saved = await this.equipment.findOneAndUpdate(
      { _id: safeId(id), version: input.version },
      { $inc: { version: 1 }, $set: update, $push: { events: event } },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException("El equipo cambió. Actualiza su ficha.");
    return equipmentView(saved);
  }

  async plan(id: string) {
    const row = await this.plans.findOne({ _id: safeId(id) });
    if (!row) return emptyPlan;
    const { _id, ...values } = row;
    return values;
  }

  async savePlan(id: string, raw: unknown) {
    const work = await this.work(id);
    const { revision, ...data } = parse(workPlanInput, raw);
    const materials = data.materials.map((row) => ({
      ...row,
      materialId: String(safeId(row.materialId)),
    }));
    const equipment = data.equipment.map((idOf) => String(safeId(idOf)));
    const [materialCount, equipmentCount] = await Promise.all([
      this.inventory.materials.countDocuments({
        _id: { $in: materials.map((row) => safeId(row.materialId)) },
      }),
      this.equipment.countDocuments({ _id: { $in: equipment.map(safeId) } }),
    ]);
    if (
      materialCount !== materials.length ||
      equipmentCount !== equipment.length
    )
      throw new BadRequestException("Revisa los códigos del plan.");
    try {
      const row = await this.plans.findOneAndUpdate(
        { _id: work._id, revision },
        { $set: { ...data, materials, equipment }, $inc: { revision: 1 } },
        { upsert: revision === 0, returnDocument: "after" },
      );
      if (row) return this.supply(id);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    throw new ConflictException("El plan de obra cambió. Vuelve a abrirlo.");
  }

  async supply(id: string): Promise<WorkSupply> {
    const work = await this.work(id);
    const workId = String(work._id);
    await this.inventory.flush();
    const [plan, orders, movements] = await Promise.all([
      this.plan(workId),
      this.orders
        .find({ workId, cancelled: { $ne: true } })
        .sort({ _id: -1 })
        .limit(1000)
        .toArray(),
      this.inventory.ledger
        .aggregate<{
          _id: { materialId: string; kind: string };
          quantity: number;
        }>([
          {
            $match: {
              leadId: workId,
              kind: { $in: ["consumption", "return", "dispatch"] },
            },
          },
          {
            $group: {
              _id: { materialId: "$materialId", kind: "$kind" },
              quantity: { $sum: "$quantity" },
            },
          },
        ])
        .toArray(),
    ]);
    const ids = [
      ...new Set([
        ...plan.materials.map((row) => row.materialId),
        ...orders.flatMap((row) => row.items.map((item) => item.materialId)),
        ...movements.map((row) => row._id.materialId),
      ]),
    ];
    const [materials, tools] = await Promise.all([
      this.inventory.materials
        .find({ _id: { $in: ids.map(safeId) } })
        .sort({ sku: 1 })
        .toArray(),
      this.equipment
        .find({
          $or: [
            { _id: { $in: plan.equipment.map(safeId) } },
            { "assignment.workId": workId },
          ],
        })
        .sort({ code: 1 })
        .toArray(),
    ]);
    return {
      plan,
      materials: materials.map((row) => {
        const materialId = String(row._id);
        const lines = orders.flatMap((order) =>
          order.items.filter((item) => item.materialId === materialId),
        );
        const moved = (kind: string) =>
          movements.find(
            (item) =>
              item._id.materialId === materialId && item._id.kind === kind,
          )?.quantity || 0;
        const sum = (field: "requested" | "ordered" | "received") =>
          lines.reduce((total, line) => total + milli(line[field]), 0) / 1000;
        return {
          materialId,
          name: row.name,
          sku: row.sku,
          unit: row.unit,
          planned:
            plan.materials.find((item) => item.materialId === materialId)
              ?.quantity || 0,
          requested: sum("requested"),
          ordered: sum("ordered"),
          received: sum("received"),
          delivered: moved("dispatch"),
          consumed: moved("consumption"),
          returned: moved("return"),
        };
      }),
      equipment: tools.map((row) => ({
        id: String(row._id),
        code: row.code,
        name: row.name,
        assigned: row.assignment?.workId === workId,
      })),
      purchases: orders.map((row) => ({
        id: String(row._id),
        supplier: row.supplier,
        status: purchaseView(row).status,
      })),
    };
  }
}
