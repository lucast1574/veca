import { literalSearch } from "../common/literal-search";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import {
  dispatchSchema,
  guideUnitForMaterial,
  quantitySchema,
  isDemoLead,
  DEMO_CASES,
  type DemoLink,
  type Dispatch,
  type DispatchInput,
  type DispatchStatus,
  type GuideWork,
  type Lead,
} from "@veca/content";
import { randomUUID, createHash } from "node:crypto";
import { CrmRepository } from "../crm/crm.repository";
import { InventoryService } from "../inventory/inventory.service";
import { Database } from "../database/database.module";
import { parse } from "../common/validation";
import {
  GuideProvider,
  GuideRequestError,
  limaDate,
  type GuideResult,
} from "./guide-provider";

type DispatchRecord = {
  _id: ObjectId;
  leadId: string;
  workName: string;
  accountingCreationHash?: string;
  demo: boolean;
  data: DispatchInput;
  status: DispatchStatus;
  version: number;
  observation: string;
  guideNumber: string;
  externalId?: string;
  attemptKey?: string;
  departedAt?: string;
  createdAt: string;
  updatedAt: string;
  events: { action: string; actor: string; at: string }[];
};

const accepted = ["accepted", "observed"];
const reviewable = ["review", "rejected"] as const;
const editable = ["draft", "returned"] as const;
const operationalStages: Lead["stage"][] = ["coordination", "execution"];

function idOf(id: string) {
  if (!/^[0-9a-f]{24}$/i.test(id))
    throw new NotFoundException("Registro no encontrado.");
  return new ObjectId(id);
}

function view(record: DispatchRecord): Dispatch {
  const stalled =
    record.status === "sending" &&
    Date.now() - Date.parse(record.updatedAt) > 45_000;
  return {
    ...record.data,
    id: String(record._id),
    leadId: record.leadId,
    workName: record.workName,
    createdInAccounting: Boolean(record.accountingCreationHash),
    demo: record.demo,
    version: record.version,
    status: stalled ? "pending" : record.status,
    observation: stalled
      ? "El envío quedó sin confirmar. Administración debe verificarlo antes de volver a emitir."
      : record.observation,
    guideNumber: record.guideNumber,
    departedAt: record.departedAt,
    canCheckStatus: record.status === "pending" && Boolean(record.externalId),
  };
}

export function guideIssues(data: DispatchInput): string[] {
  const issues: string[] = [];
  if (!validTransfer(data.transferAt)) {
    issues.push("Indica una fecha y hora de salida válida.");
  } else if (Date.parse(data.transferAt + ":00-05:00") <= Date.now()) {
    issues.push("La salida prevista debe ser posterior a la emisión.");
  }
  if (
    !data.items.length ||
    data.items.some((item) => !item.description || item.quantity <= 0)
  )
    issues.push("Completa los materiales y sus cantidades.");
  if (!data.startAddress || !data.arrivalAddress)
    issues.push("Completa las direcciones de origen y destino.");
  if (!/^\d{6}$/.test(data.startUbigeo) || !/^\d{6}$/.test(data.arrivalUbigeo))
    issues.push("Completa los ubigeos de 6 dígitos.");
  if (
    !data.recipientName ||
    !(data.recipientType === "6" ? /^\d{11}$/ : /^\d{8}$/).test(
      data.recipientNumber,
    )
  )
    issues.push("Completa el nombre y documento del destinatario.");
  if (data.weightKg <= 0) issues.push("Indica el peso bruto en kilos.");
  if (data.motiveCode === "13" && !data.motiveDescription)
    issues.push("Describe el motivo del traslado.");
  if (data.transportMode === "01") {
    if (!/^\d{11}$/.test(data.carrierRuc))
      issues.push("Completa el RUC del transportista.");
    if (!data.carrierName)
      issues.push("Completa la razón social del transportista.");
  } else {
    if (!/^[a-z0-9]{6,8}$/i.test(data.vehiclePlate.replace(/[^a-z0-9]/gi, "")))
      issues.push("Completa la placa del vehículo.");
    if (
      !/^\d{8}$/.test(data.driverDocument) ||
      !data.driverName ||
      !data.driverLastName
    )
      issues.push("Completa el DNI, nombres y apellidos del conductor.");
    if (!/^[a-z0-9]{9,10}$/i.test(data.driverLicense))
      issues.push("Revisa la licencia del conductor.");
  }
  return issues;
}

function validTransfer(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value + ":00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value
  );
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly database: Database,
    private readonly leads: CrmRepository,
    private readonly provider: GuideProvider,
    private readonly inventory: InventoryService,
  ) {}

  private get collection() {
    return this.database.db.collection<DispatchRecord>("dispatches");
  }

  private async get(id: string, leadId?: string) {
    const doc = await this.collection.findOne({
      _id: idOf(id),
      ...(leadId ? { leadId: idOf(leadId).toHexString() } : {}),
    });
    if (!doc) throw new NotFoundException("Despacho no encontrado.");
    return doc;
  }

  async forLead(leadId: string) {
    const lead = await this.leads.get(leadId);
    return (
      await this.collection
        .find({
          leadId: lead._id.toHexString(),
          $nor: [
            { status: "draft", accountingCreationHash: { $exists: true } },
          ],
        })
        .sort({ updatedAt: -1 })
        .toArray()
    ).map(view);
  }

  async demoLink(key: DemoLink["key"], leadId: string) {
    const fixture = DEMO_CASES.find((entry) => entry.key === key)!;
    const fixtureId =
      key === "mamparas"
        ? "de0000000000000000000001"
        : "de0000000000000000000002";
    const lead = await this.leads.get(leadId);
    if (!isDemoLead(lead) || lead.name !== fixture.name)
      throw new ConflictException(
        "El despacho de ejemplo requiere su lead de demostración.",
      );
    const _id = idOf(fixtureId);
    const now = new Date().toISOString();
    const tomorrow = limaDate(new Date(Date.now() + 86_400_000));
    const data = parse(dispatchSchema, {
      startAddress: "Almacén VECA · dirección de ejemplo",
      startUbigeo: "150134",
      arrivalAddress:
        lead.address || `Dirección de ejemplo · ${fixture.district}`,
      arrivalUbigeo: fixture.ubigeo,
      transferAt: tomorrow + (key === "mamparas" ? "T08:00" : "T11:00"),
      motiveCode: "13",
      motiveDescription: "Traslado para instalación · ejemplo",
      recipientType: "6",
      recipientNumber: "00000000000",
      recipientName: "Cliente de ejemplo",
      transportMode: fixture.transport,
      carrierRuc: "",
      carrierName: fixture.transport === "01" ? "Transportista de ejemplo" : "",
      vehiclePlate: "DEMO01",
      driverDocument: "00000000",
      driverName: "Conductor",
      driverLastName: "De ejemplo",
      driverLicense: "DEMO00001",
      weightKg: 250,
      items: [
        {
          code: fixture.sku,
          description: fixture.material,
          unitCode: fixture.unitCode,
          quantity: fixture.quantity,
        },
      ],
    });
    await this.collection.updateOne(
      { _id, leadId, demo: true },
      {
        $setOnInsert: {
          _id,
          leadId,
          demo: true,
          data,
          workName: lead.name,
          status: fixture.guideStatus,
          version: 1,
          guideNumber: "",
          observation:
            fixture.guideStatus === "returned"
              ? "Falta el RUC del transportista."
              : "",
          createdAt: now,
          updatedAt: now,
          events: [{ action: "demo", actor: "Demostración", at: now }],
        },
      },
      { upsert: true },
    );
    return fixtureId;
  }

  async works(search: string): Promise<GuideWork[]> {
    const safe = literalSearch(search);
    const rows = await this.leads.collection
      .find({
        stage: { $in: operationalStages },
        name: { $not: /^\[demo\]/i },
        email: { $not: /\.invalid$/i },
        ...(safe && {
          $or: [
            { name: { $regex: safe, $options: "i" } },
            { district: { $regex: safe, $options: "i" } },
          ],
        }),
      })
      .project<Omit<GuideWork, "id"> & { _id: ObjectId }>({
        name: 1,
        district: 1,
        address: 1,
      })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(40)
      .toArray();
    return rows.map(({ _id, name, district, address }) => ({
      id: String(_id),
      name,
      district,
      address: address || "",
    }));
  }

  async queue(
    page: number,
    filter: "all" | "draft" | "review" | "issued",
    search = "",
  ) {
    const statuses: Record<typeof filter, DispatchStatus[]> = {
      all: [
        "draft",
        "review",
        "returned",
        "sending",
        "pending",
        "accepted",
        "observed",
        "rejected",
      ],
      draft: ["draft"],
      review: ["review", "sending", "pending", "rejected"],
      issued: ["accepted", "observed"],
    };
    const safe = literalSearch(search);
    const size = 30;
    const docs = await this.collection
      .aggregate<DispatchRecord>([
        {
          $match: {
            status: { $in: statuses[filter] },
            $nor: [
              { status: "draft", accountingCreationHash: { $exists: false } },
            ],
            ...(safe
              ? {
                  $or: [
                    "workName",
                    "guideNumber",
                    "data.recipientName",
                    "data.recipientNumber",
                  ].map((field) => ({
                    [field]: { $regex: safe, $options: "i" },
                  })),
                }
              : {}),
          },
        },
        {
          $addFields: {
            priority: {
              $switch: {
                branches: [
                  { case: { $in: ["$status", statuses.review] }, then: 0 },
                  {
                    case: { $in: ["$status", ["draft", "returned"]] },
                    then: 1,
                  },
                ],
                default: 2,
              },
            },
          },
        },
        {
          $sort: {
            priority: 1,
            "data.transferAt": filter === "issued" ? -1 : 1,
            _id: 1,
          },
        },
        { $skip: (page - 1) * size },
        { $limit: size + 1 },
      ])
      .toArray();
    return {
      hasMore: docs.length > size,
      items: docs.slice(0, size).map((doc) => ({
        id: String(doc._id),
        workName: doc.workName,
        status: doc.status,
        demo: doc.demo,
        guideNumber: doc.guideNumber,
        transportMode: doc.data.transportMode,
        transferAt: doc.data.transferAt,
        issue: doc.status === "review" ? guideIssues(doc.data)[0] || "" : "",
      })),
    };
  }

  async detail(id: string) {
    const doc = await this.get(id);
    if (doc.status === "draft" && !doc.accountingCreationHash)
      throw new NotFoundException("Despacho no encontrado.");
    return { dispatch: view(doc), issues: guideIssues(doc.data) };
  }

  async create(
    leadId: string,
    input: unknown,
    actor: string,
    accountingId?: string,
  ) {
    const data = parse(dispatchSchema, input);
    const lead = await this.leads.get(leadId);
    if (!operationalStages.includes(lead.stage))
      throw new ConflictException(
        "Prepara el despacho cuando la obra esté en coordinación o ejecución.",
      );
    const demo = isDemoLead(lead);
    if (accountingId && demo)
      throw new ConflictException("Elige una obra real para preparar la guía.");
    const now = new Date().toISOString();
    const record: DispatchRecord = {
      _id: accountingId ? idOf(accountingId) : new ObjectId(),
      leadId: lead._id.toHexString(),
      workName: lead.name,
      data,
      demo,
      status: "draft",
      version: 1,
      observation: "",
      guideNumber: "",
      createdAt: now,
      updatedAt: now,
      events: [{ action: "draft", actor, at: now }],
    };
    if (accountingId) {
      const accountingCreationHash = createHash("sha256")
        .update(JSON.stringify([record.leadId, actor, data]))
        .digest("hex");
      const stored = await this.collection.findOneAndUpdate(
        { _id: record._id },
        { $setOnInsert: { ...record, accountingCreationHash } },
        { upsert: true, returnDocument: "after" },
      );
      if (stored?.accountingCreationHash !== accountingCreationHash)
        throw new ConflictException(
          "Ya existe una guía con esta solicitud. Vuelve a Guías para abrirla.",
        );
      return view(stored);
    }
    await this.collection.insertOne(record);
    return view(record);
  }

  async updateDraft(
    id: string,
    version: number,
    input: unknown,
    actor: string,
  ) {
    const doc = await this.get(id);
    if (!doc.accountingCreationHash)
      throw new NotFoundException("Borrador de Contabilidad no encontrado.");
    const data = parse(dispatchSchema, input);
    const dispatch = await this.change(
      doc,
      version,
      ["draft", "rejected"],
      {
        data,
        status: "draft",
        observation: "",
        guideNumber: "",
        externalId: "",
      },
      actor,
      "edit",
    );
    return { dispatch, issues: guideIssues(data) };
  }

  private async operationsDraft(leadId: string, id: string) {
    const doc = await this.get(id, leadId);
    if (doc.accountingCreationHash)
      throw new NotFoundException("Despacho de Operaciones no encontrado.");
    return doc;
  }

  async update(
    leadId: string,
    id: string,
    version: number,
    input: unknown,
    actor: string,
  ) {
    const doc = await this.operationsDraft(leadId, id);
    const data = parse(dispatchSchema, input);
    return this.change(doc, version, editable, { data }, actor, "edit");
  }

  async submit(leadId: string, id: string, version: number, actor: string) {
    const doc = await this.operationsDraft(leadId, id);
    const lead = await this.leads.get(leadId);
    if (!operationalStages.includes(lead.stage))
      throw new ConflictException(
        "El despacho solo se envía durante coordinación o ejecución.",
      );
    if (
      !validTransfer(doc.data.transferAt) ||
      !doc.data.items.length ||
      doc.data.items.some((item) => !item.description || item.quantity <= 0)
    )
      throw new BadRequestException(
        "Completa la fecha de salida y los materiales con sus cantidades.",
      );
    return this.change(
      doc,
      version,
      editable,
      { status: "review", observation: "" },
      actor,
    );
  }

  async sendBack(
    id: string,
    version: number,
    observation: string,
    actor: string,
  ) {
    const doc = await this.get(id);
    if (doc.accountingCreationHash)
      throw new ConflictException("Corrige esta guía en Contabilidad.");
    return this.change(
      doc,
      version,
      reviewable,
      { status: "returned", observation },
      actor,
    );
  }

  async issue(id: string, version: number, actor: string) {
    const doc = await this.get(id);
    const ready = doc.accountingCreationHash ? "draft" : "review";
    if (doc.version !== version || doc.status !== ready)
      throw new ConflictException(
        "El despacho cambió. Vuelve a cargarlo para continuar.",
      );
    const lead = await this.leads.get(doc.leadId);
    if (doc.demo || isDemoLead(lead))
      throw new ConflictException(
        "Este despacho es de demostración y no puede emitirse.",
      );
    if (!operationalStages.includes(lead.stage))
      throw new ConflictException(
        "Revisa la etapa de esta obra antes de emitir la guía.",
      );
    const issues = guideIssues(doc.data);
    if (issues.length) throw new BadRequestException(issues);
    await this.stockLines(doc.data.items);
    await this.provider.assertIssuerEnabled();
    const attemptKey = randomUUID();
    const locked = await this.change(
      doc,
      version,
      [ready],
      {
        status: "sending",
        attemptKey,
        externalId: "",
        guideNumber: "",
      },
      actor,
    );
    let result: GuideResult;
    try {
      result = await this.provider.issue(doc.data, attemptKey, limaDate());
    } catch (error) {
      const rejected = error instanceof GuideRequestError && error.definitive;
      return this.change(
        doc,
        locked.version,
        ["sending"],
        {
          status: rejected ? "rejected" : "pending",
          observation: rejected
            ? "El envío fue rechazado. Revisa los datos o consulta con administración."
            : "No se pudo confirmar el envío. Administración debe verificarlo antes de volver a emitir.",
        },
        actor,
      );
    }
    return this.recordResult(doc, locked.version, ["sending"], result, actor);
  }

  async check(id: string, version: number, actor: string) {
    const doc = await this.get(id);
    if (doc.status !== "pending" || !doc.externalId)
      throw new ConflictException(
        "Este envío no se puede consultar desde el panel.",
      );
    let result: GuideResult;
    try {
      result = await this.provider.status(doc.externalId);
    } catch {
      throw new ServiceUnavailableException(
        "La consulta no está disponible. Vuelve a intentarlo en unos minutos.",
      );
    }
    if (result.externalId !== doc.externalId)
      throw new ServiceUnavailableException(
        "La consulta no pudo confirmar la identidad de la guía.",
      );
    return this.recordResult(doc, version, ["pending"], result, actor);
  }

  private async stockLines(items: DispatchInput["items"]) {
    const totals = new Map<string, number>();
    for (const item of items) {
      if (!item.materialId) continue;
      const material = await this.inventory.materials.findOne({
        _id: idOf(item.materialId),
      });
      if (
        !material ||
        item.code !== material.sku ||
        item.unitCode !== guideUnitForMaterial[material.unit]
      )
        throw new ConflictException(
          `Revisa el código y la unidad de ${item.description} en Inventario.`,
        );
      parse(quantitySchema, item.quantity);
      const key = String(material._id);
      totals.set(
        key,
        (totals.get(key) || 0) + Math.round(item.quantity * 1000),
      );
    }
    return [...totals].map(([materialId, milli]) => ({
      materialId,
      quantity: parse(quantitySchema, milli / 1000),
    }));
  }

  async depart(leadId: string, id: string, actor: string) {
    const row = await this.get(id, leadId);
    if (row.demo || !accepted.includes(row.status))
      throw new ConflictException(
        "Confirma la salida con una guía emitida para una obra real.",
      );
    if (row.departedAt) return view(row);
    const stockLines = await this.stockLines(row.data.items);
    const lines = stockLines.map(({ materialId, quantity }) => {
      const hash = createHash("sha256")
        .update(`dispatch:${row._id}:${materialId}`)
        .digest("hex");
      const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return { materialId, quantity, operationId };
    });
    for (const item of lines) {
      await this.inventory.flush(idOf(item.materialId));
      const material = await this.inventory.materials.findOne({
        _id: idOf(item.materialId),
      });
      const exists = await this.inventory.ledger.findOne({
        _id: `${item.materialId}:${item.operationId}`,
      });
      if (
        !exists &&
        material &&
        material.balanceMilli < Math.round(item.quantity * 1000)
      )
        throw new ConflictException(
          `Stock insuficiente de ${material.name}. Revisa el saldo y vuelve a confirmar la salida.`,
        );
    }
    for (const item of lines) {
      await this.inventory.move(
        item.materialId,
        {
          operationId: item.operationId,
          kind: "consumption",
          quantity: item.quantity,
          leadId: row.leadId,
          reason: `Salida con guía ${row.guideNumber}`,
        },
        actor,
        { dispatchId: String(row._id) },
      );
    }
    const at = new Date().toISOString();
    await this.collection.updateOne(
      { _id: row._id, departedAt: { $exists: false } },
      {
        $set: { departedAt: at },
        $inc: { version: 1 },
        $push: { events: { action: "depart", actor, at } },
      },
    );
    return view(await this.get(id, leadId));
  }

  async download(id: string, leadId?: string) {
    const doc = await this.get(id, leadId);
    if (!accepted.includes(doc.status) || !doc.externalId)
      throw new NotFoundException("La guía todavía no está disponible.");
    try {
      return await this.provider.pdf(doc.externalId);
    } catch {
      throw new ServiceUnavailableException(
        "La guía no está disponible en este momento.",
      );
    }
  }

  private recordResult(
    doc: DispatchRecord,
    version: number,
    allowed: DispatchStatus[],
    result: GuideResult,
    actor: string,
  ) {
    const status: DispatchStatus =
      result.status === "accepted"
        ? "accepted"
        : ["observed", "accepted_with_observations"].includes(result.status)
          ? "observed"
          : result.status === "rejected"
            ? "rejected"
            : "pending";
    return this.change(
      doc,
      version,
      allowed,
      {
        externalId: result.externalId,
        guideNumber: result.documentNumber || doc.guideNumber,
        status,
        observation:
          status === "rejected"
            ? "SUNAT rechazó la guía. Revisa los datos antes de corregirla."
            : "",
      },
      actor,
    );
  }

  private async change(
    doc: DispatchRecord,
    version: number,
    allowed: readonly DispatchStatus[],
    set: Partial<
      Pick<
        DispatchRecord,
        | "data"
        | "status"
        | "observation"
        | "externalId"
        | "guideNumber"
        | "attemptKey"
      >
    >,
    actor: string,
    action = set.status ?? "update",
  ) {
    const now = new Date().toISOString();
    const updated = await this.collection.findOneAndUpdate(
      { _id: doc._id, version, status: { $in: [...allowed] } },
      {
        $set: { ...set, updatedAt: now },
        $inc: { version: 1 },
        $push: { events: { action, actor, at: now } },
      },
      { returnDocument: "after" },
    );
    if (!updated)
      throw new ConflictException(
        "El despacho cambió. Vuelve a cargarlo para continuar.",
      );
    return view(updated);
  }
}
