import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import {
  type SessionUser,
  type SupplyRequest,
  supplyRequestInput,
  supplyActionInput,
  type SupplyAction,
  guideUnitForMaterial,
} from "@veca/content";
import { Database } from "../database/database.module";
import { WorkAccess } from "../crm/work-access.service";
import { CrmEvents } from "../crm/crm.events";
import { parse } from "../common/validation";
import { InventoryService } from "./inventory.service";
import { WarehouseService } from "./warehouse.service";
import { DispatchService } from "../dispatch/dispatch.service";
const quantity = (value: number) => Math.round(value * 1000) / 1000;
type Operation = SupplyRequest["operations"][number] & { failed?: boolean };
type Document = Omit<SupplyRequest, "id" | "operations"> & {
  _id: ObjectId;
  operations: Operation[];
  pending?: Operation;
};

@Injectable()
export class SupplyRequests {
  constructor(
    private readonly db: Database,
    private readonly access: WorkAccess,
    private readonly inventory: InventoryService,
    private readonly warehouse: WarehouseService,
    private readonly dispatches: DispatchService,
    private readonly events: CrmEvents,
  ) {}
  get collection() {
    return this.db.db.collection<Document>("supply_requests");
  }
  view({ _id, ...row }: Document): SupplyRequest {
    return { ...row, id: String(_id) };
  }

  async list(workId?: string, page = 1, filter: "open" | "all" = "open") {
    if (workId) workId = String(new ObjectId(workId));
    const rows = await this.collection
      .find({
        ...(workId ? { workId } : {}),
        ...(filter === "open"
          ? {
              $or: [
                { pending: { $exists: true } },
                { reserved: { $gt: 0 } },
                { returnRequested: { $gt: 0 } },
                {
                  $and: [
                    { cancelled: false },
                    { $expr: { $lt: ["$delivered", "$quantity"] } },
                  ],
                },
                { $expr: { $lt: ["$received", "$delivered"] } },
              ],
            }
          : {}),
      })
      .sort({ neededBy: 1, createdAt: -1, _id: -1 })
      .skip((page - 1) * 30)
      .limit(31)
      .toArray();
    const materials = workId
      ? []
      : await this.inventory.materials
          .find({
            _id: { $in: rows.map((row) => new ObjectId(row.materialId)) },
          })
          .toArray();
    const available = new Map(
      materials.map((row) => [
        String(row._id),
        this.inventory.view(row).available,
      ]),
    );
    return {
      items: rows.slice(0, 30).map((row) => ({
        ...this.view(row),
        ...(!workId ? { available: available.get(row.materialId) || 0 } : {}),
      })),
      hasMore: rows.length > 30,
    };
  }
  async guides(id: string) {
    id = String(this.inventory.id(id));
    const request = await this.collection.findOne({
      _id: this.inventory.id(id),
    });
    if (!request) throw new NotFoundException();
    const rows = await this.db.db
      .collection("dispatches")
      .find({
        leadId: request.workId,
        demo: { $ne: true },
        status: { $in: ["accepted", "observed"] },
        departedAt: { $exists: false },
        $or: [{ departureSource: { $exists: false } }, { departureSource: id }],
      })
      .limit(100)
      .toArray();
    return rows.flatMap((row) => {
      const items: { materialId?: string; quantity: number }[] =
        row.data?.items || [];
      if (
        !items.length ||
        items.some((item) => item.materialId !== request.materialId)
      )
        return [];
      return [
        {
          id: String(row._id),
          number: String(row.guideNumber || "Guía aceptada"),
          quantity:
            Math.round(
              items.reduce((sum, item) => sum + item.quantity, 0) * 1000,
            ) / 1000,
        },
      ];
    });
  }
  async create(workId: string, input: unknown, user: SessionUser) {
    if (
      !user.permissions.some(
        (p) => p === "works_manage" || p === "inventory_request",
      )
    )
      throw new ForbiddenException();
    const work = await this.access.get(workId, user);
    workId = String(work._id);
    if (work.stage === "completed")
      throw new ConflictException("La obra ya está realizada.");
    const data = parse(supplyRequestInput, input);
    const material = await this.inventory.materials.findOne({
      _id: new ObjectId(data.materialId),
    });
    if (!material) throw new NotFoundException("Material no encontrado.");
    const { id, ...fields } = data;
    const row = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $setOnInsert: {
          ...fields,
          workId,
          workName: work.name,
          materialName: material.name,
          sku: material.sku,
          unit: material.unit,
          version: 1,
          reserved: 0,
          delivered: 0,
          received: 0,
          returnRequested: 0,
          returned: 0,
          cancelled: false,
          createdAt: new Date().toISOString(),
          requestedBy: user.id,
          operations: [],
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (
      !row ||
      row.workId !== workId ||
      row.materialId !== data.materialId ||
      row.quantity !== data.quantity ||
      row.reason !== data.reason ||
      row.neededBy !== data.neededBy
    )
      throw new ConflictException(
        "Esta solicitud ya se registró con otros datos.",
      );
    this.events.emit("supplies");
    return this.view(row);
  }

  private authorize(
    action: SupplyAction["action"],
    user: SessionUser,
    warehouse: boolean,
  ) {
    const permission = {
      reserve: "inventory_reserve",
      cancel: "inventory_reserve",
      deliver: "inventory_dispatch",
      accept_return: "inventory_receive",
      purchase: "inventory_request",
      receive: "works_report",
      request_return: "works_report",
    } as const;
    if (warehouse && !user.permissions.includes("inventory"))
      throw new ForbiddenException();
    if (!warehouse && !["receive", "request_return"].includes(action))
      throw new ForbiddenException();
    if (
      !user.permissions.includes(permission[action]) &&
      !(!warehouse && user.permissions.includes("works_manage"))
    )
      throw new ForbiddenException();
  }

  async action(
    id: string,
    input: unknown,
    user: SessionUser,
    warehouse: boolean,
  ) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    id = String(new ObjectId(id));
    const data = parse(supplyActionInput, input);
    this.authorize(data.action, user, warehouse);
    let row = await this.collection.findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException();
    if (!warehouse) await this.access.get(row.workId, user);
    const previous = row.operations.find(
      (op) => op.operationId === data.operationId,
    );
    if (
      previous &&
      (previous.action !== data.action ||
        previous.quantity !== data.quantity ||
        previous.guideId !== data.guideId ||
        previous.note !== data.note)
    )
      throw new ConflictException("La operación ya tiene otros datos.");
    if (previous?.failed)
      throw new ConflictException(
        "Revisa la solicitud y registra una nueva operación.",
      );
    if (previous?.completed) return this.view(row);
    if (!previous) {
      if (row.pending || row.version !== data.version)
        throw new ConflictException(
          "La solicitud cambió. Actualízala antes de continuar.",
        );
      if (
        row.cancelled &&
        !["receive", "request_return", "accept_return"].includes(data.action)
      )
        throw new ConflictException("La solicitud está cancelada.");
      if (row.operations.length >= 200)
        throw new ConflictException(
          "La solicitud alcanzó el límite de movimientos.",
        );
      const remaining = quantity(row.quantity - row.delivered);
      if (data.action === "reserve") {
        const material = await this.inventory.detail(row.materialId);
        if (data.quantity > quantity((material.available || 0) + row.reserved))
          throw new ConflictException(
            "No hay existencias disponibles para esa reserva.",
          );
      }
      if (data.action === "reserve" && data.quantity > remaining)
        throw new BadRequestException(
          "La reserva supera lo pendiente de entregar.",
        );
      if (
        ["deliver", "receive", "request_return", "accept_return"].includes(
          data.action,
        ) &&
        data.quantity <= 0
      )
        throw new BadRequestException("Indica una cantidad mayor a cero.");
      if (
        data.action === "deliver" &&
        (!data.guideId || data.quantity > quantity(row.reserved))
      )
        throw new ConflictException(
          "Reserva la cantidad y selecciona una guía aceptada.",
        );
      if (
        data.action === "receive" &&
        data.quantity > row.delivered - row.received + 0.00001
      )
        throw new BadRequestException("La recepción supera lo entregado.");
      if (
        data.action === "request_return" &&
        data.quantity >
          row.received - row.returned - row.returnRequested + 0.00001
      )
        throw new BadRequestException(
          "La devolución supera lo recibido pendiente de retorno.",
        );
      if (
        data.action === "accept_return" &&
        data.quantity > row.returnRequested + 0.00001
      )
        throw new BadRequestException("La devolución no fue solicitada.");
      if (
        data.action === "purchase" &&
        (row.purchaseId || quantity(remaining - row.reserved) <= 0)
      )
        throw new ConflictException("No hay faltantes por solicitar.");
      if (data.action === "deliver") await this.validateGuide(row, data);
      const operation: Operation = {
        ...data,
        actor: user.username,
        at: new Date().toISOString(),
        completed: false,
      };
      const locked = await this.collection.findOneAndUpdate(
        { _id: row._id, version: data.version, pending: { $exists: false } },
        {
          $set: { pending: operation },
          $push: { operations: operation },
          $inc: { version: 1 },
        },
        { returnDocument: "after" },
      );
      if (!locked)
        throw new ConflictException(
          "La solicitud cambió. Revisa sus movimientos.",
        );
      row = locked;
    }
    const op = row.pending;
    if (!op || op.operationId !== data.operationId)
      throw new ConflictException("Hay otra operación por confirmar.");
    const fields: Partial<Document> = {};
    try {
      if (op.action === "reserve" || op.action === "cancel") {
        const target = op.action === "cancel" ? 0 : op.quantity;
        await this.inventory.reserve(
          row.materialId,
          id,
          row.workId,
          target,
          op.version,
        );
        fields.reserved = target;
        if (op.action === "cancel") fields.cancelled = true;
      }
      if (op.action === "deliver") {
        await this.dispatches.depart(row.workId, op.guideId!, op.actor, id);
        fields.delivered = quantity(row.delivered + op.quantity);
        fields.reserved = quantity(row.reserved - op.quantity);
      }
      if (op.action === "receive")
        fields.received = quantity(row.received + op.quantity);
      if (op.action === "request_return")
        fields.returnRequested = quantity(row.returnRequested + op.quantity);
      if (op.action === "accept_return") {
        await this.inventory.move(
          row.materialId,
          {
            operationId: op.operationId,
            leadId: row.workId,
            kind: "return",
            quantity: op.quantity,
            reason: op.note || "Devolución de solicitud a Almacén",
          },
          op.actor,
        );
        fields.returned = quantity(row.returned + op.quantity);
        fields.returnRequested = quantity(row.returnRequested - op.quantity);
      }
      if (op.action === "purchase") {
        const purchase = await this.warehouse.requestPurchase(
          {
            id: new ObjectId(row._id).toHexString(),
            workId: row.workId,
            reason: row.reason,
            materials: [
              {
                materialId: row.materialId,
                quantity:
                  Math.round(
                    (row.quantity - row.delivered - row.reserved) * 1000,
                  ) / 1000,
              },
            ],
          },
          op.actor,
        );
        fields.purchaseId = purchase.id;
      }
    } catch (error) {
      // Never clear an operation merely because a concurrent stock write won:
      // another retry may already have applied its idempotent inventory effect.
      // Only a guide permanently claimed by another route is definitive.
      const guide = op.guideId
        ? await this.db.db
            .collection("dispatches")
            .findOne({ _id: new ObjectId(op.guideId) })
        : null;
      if (
        error instanceof ConflictException &&
        guide?.departureSource &&
        guide.departureSource !== id
      ) {
        await this.collection.updateOne(
          { _id: row._id, "pending.operationId": op.operationId },
          {
            $unset: { pending: "" },
            $set: {
              "operations.$[op].completed": true,
              "operations.$[op].failed": true,
            },
            $inc: { version: 1 },
          },
          { arrayFilters: [{ "op.operationId": op.operationId }] },
        );
      }
      throw error;
    }
    const saved = await this.collection.findOneAndUpdate(
      { _id: row._id, "pending.operationId": op.operationId },
      {
        $set: { ...fields, "operations.$[op].completed": true },
        $unset: { pending: "" },
        $inc: { version: 1 },
      },
      {
        arrayFilters: [{ "op.operationId": op.operationId }],
        returnDocument: "after",
      },
    );
    this.events.emit("supplies");
    return this.view(
      saved || (await this.collection.findOne({ _id: row._id }))!,
    );
  }

  private async validateGuide(row: Document, action: SupplyAction) {
    const guide = await this.db.db.collection("dispatches").findOne({
      _id: new ObjectId(action.guideId),
      leadId: row.workId,
      demo: { $ne: true },
      status: { $in: ["accepted", "observed"] },
      departedAt: { $exists: false },
      $or: [
        { departureSource: { $exists: false } },
        { departureSource: String(row._id) },
      ],
    });
    const items: {
      materialId?: string;
      quantity: number;
      code: string;
      unitCode: string;
    }[] = guide?.data?.items || [];
    const material = await this.inventory.materials.findOne({
      _id: new ObjectId(row.materialId),
    });
    if (
      !guide ||
      !material ||
      !items.length ||
      items.some(
        (item) =>
          item.materialId !== row.materialId ||
          item.code !== material.sku ||
          item.unitCode !== guideUnitForMaterial[material.unit],
      ) ||
      Math.abs(
        items.reduce((sum, item) => sum + item.quantity, 0) - action.quantity,
      ) > 0.00001
    )
      throw new BadRequestException(
        "La guía debe corresponder a esta obra, este material y la cantidad de la entrega.",
      );
  }
}
