import { WorkGate } from "../crm/work-gate.service";
import {
  SupplyDispatches,
  stableOperation,
} from "../inventory/supply-dispatch.service";
import { literalSearch } from "../common/literal-search";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { ObjectId } from "mongodb";
import {
  dispatchSchema,
  GUIDE_ITEM_DESCRIPTION_LIMIT,
  guideItemDescription,
  guideUnitForMaterial,
  quantitySchema,
  isDemoLead,
  DEMO_CASES,
  type DemoLink,
  type SupplyRequest,
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
import { config } from "../common/config";
import {
  canReplayFiscalAttempt,
  fiscalAttemptScope,
  type FiscalAttemptContext,
} from "../common/fiscal-config";
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
  supplyRequestId?: string;
  activeSupplyRequestId?: string;
  accountingCreationHash?: string;
  creationHash?: string;
  demo: boolean;
  data: DispatchInput;
  status: DispatchStatus;
  version: number;
  observation: string;
  guideNumber: string;
  externalId?: string;
  attemptKey?: string;
  attemptContext?: FiscalAttemptContext & { issueDate: string; series: string };
  departedAt?: string;
  departureSource?: string;
  departureEpoch?: number;
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
    canCheckStatus:
      (record.status === "pending" || stalled) &&
      Boolean(
        record.externalId ||
        (record.attemptKey && canReplayFiscalAttempt(record.attemptContext)),
      ),
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
  if (
    data.items.some(
      (item) =>
        guideItemDescription(item).length > GUIDE_ITEM_DESCRIPTION_LIMIT,
    )
  )
    issues.push(
      "Acorta las descripciones de los materiales para que incluyan sus medidas.",
    );
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
    private readonly supplies: SupplyDispatches,
    private readonly gate: WorkGate,
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
          workName: lead.workName || lead.name,
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
        "discarded",
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

  async requestSupplyGuide(
    requestId: string,
    version: number,
    transferAt: string,
    actor: string,
  ) {
    const requests = this.database.db.collection<
      Omit<SupplyRequest, "id"> & { _id: ObjectId }
    >("supply_requests");
    const source = await requests.findOne({ _id: idOf(requestId) });
    if (!source) throw new NotFoundException("Solicitud no encontrada.");
    return this.gate.run(
      source.workId,
      `guide-request:${requestId}`,
      async () => {
        const row = await requests.findOne({ _id: source._id });
        if (!row || row.cancelled || row.pending || row.reserved <= 0)
          throw new ConflictException(
            "Reserva primero el material y actualiza la solicitud.",
          );
        const existing = await this.collection.findOne({
          supplyRequestId: requestId,
          status: { $ne: "discarded" },
          departedAt: { $exists: false },
        });
        if (existing) {
          if (existing.status === "draft")
            return this.submitRecord(
              row.workId,
              String(existing._id),
              existing.version,
              actor,
            );
          return view(existing);
        }
        if (row.version !== version)
          throw new ConflictException(
            "La solicitud cambió. Actualízala antes de pedir la guía.",
          );
        if (
          !validTransfer(transferAt) ||
          Date.parse(transferAt + ":00-05:00") <= Date.now()
        )
          throw new BadRequestException(
            "Indica una fecha y hora futura para el traslado.",
          );
        const material = await this.inventory.detail(row.materialId);
        const lead = await this.leads.get(row.workId);
        const data: DispatchInput = {
          startAddress: "",
          startUbigeo: "",
          arrivalAddress: lead.address || lead.workLocation || "",
          arrivalUbigeo: "",
          transferAt,
          motiveCode: "13",
          motiveDescription: "Traslado de materiales a obra",
          recipientType: "6",
          recipientNumber: "",
          recipientName: lead.name,
          transportMode: "02",
          carrierRuc: "",
          carrierName: "",
          vehiclePlate: "",
          driverDocument: "",
          driverName: "",
          driverLastName: "",
          driverLicense: "",
          weightKg: 0,
          items: [
            {
              code: material.sku,
              materialId: row.materialId,
              description: material.name,
              unitCode: guideUnitForMaterial[material.unit],
              quantity: row.reserved,
            },
          ],
        };
        const previous = await this.collection.findOne(
          {
            supplyRequestId: requestId,
            $or: [{ status: "discarded" }, { departedAt: { $exists: true } }],
          },
          { sort: { createdAt: -1, _id: -1 } },
        );
        const id = createHash("sha256")
          .update(
            `supply-guide:${requestId}:${version}:${previous?._id || "first"}`,
          )
          .digest("hex")
          .slice(0, 24);
        let draft: Dispatch;
        try {
          draft = await this.createRecord(
            row.workId,
            data,
            actor,
            undefined,
            id,
            requestId,
          );
        } catch (error) {
          const active = await this.collection.findOne({
            activeSupplyRequestId: requestId,
          });
          if (!active) throw error;
          if (active.status !== "draft") return view(active);
          draft = view(active);
        }
        return this.submitRecord(row.workId, draft.id, draft.version, actor);
      },
    );
  }
  async supplyGuideRequests(ids: string[]) {
    const rows = await this.collection
      .find({
        supplyRequestId: { $in: ids },
        status: { $ne: "discarded" },
        departedAt: { $exists: false },
      })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    const result = new Map<
      string,
      { id: string; status: DispatchStatus; number: string }
    >();
    for (const row of rows)
      if (!result.has(row.supplyRequestId!))
        result.set(row.supplyRequestId!, {
          id: String(row._id),
          status: row.status,
          number: row.guideNumber,
        });
    return result;
  }

  async create(
    leadId: string,
    input: unknown,
    actor: string,
    accountingId?: string,
  ) {
    const { creationId, ...data } = parse(
      dispatchSchema.extend({
        creationId: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
      }),
      input,
    );
    const id = accountingId || creationId || String(new ObjectId());
    return this.gate.run(leadId, `guide:${id}`, () =>
      this.createRecord(leadId, data, actor, accountingId, id),
    );
  }

  private async withItemDimensions(
    data: DispatchInput,
    previous: DispatchInput["items"] = [],
  ) {
    const ids = [
      ...new Set(
        data.items.flatMap(({ materialId }) =>
          materialId ? [materialId.toLowerCase()] : [],
        ),
      ),
    ];
    if (!ids.length) return data;
    const snapshots = new Map(
      previous.flatMap(({ materialId, dimensions }) =>
        materialId && dimensions
          ? [[materialId.toLowerCase(), dimensions] as const]
          : [],
      ),
    );
    const materials = await this.inventory.materials
      .find(
        { _id: { $in: ids.filter((id) => !snapshots.has(id)).map(idOf) } },
        { projection: { dimensions: 1 } },
      )
      .toArray();
    for (const material of materials) {
      if (material.dimensions)
        snapshots.set(String(material._id), material.dimensions);
    }
    return {
      ...data,
      items: data.items.map((item) => {
        if (!item.materialId) return item;
        const { dimensions, ...line } = item;
        const snapshot = snapshots.get(item.materialId.toLowerCase());
        return snapshot ? { ...line, dimensions: snapshot } : line;
      }),
    };
  }

  private async createRecord(
    leadId: string,
    input: unknown,
    actor: string,
    accountingId?: string,
    creationId?: string,
    supplyRequestId?: string,
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
      _id: idOf(accountingId || creationId!),
      ...(supplyRequestId
        ? { supplyRequestId, activeSupplyRequestId: supplyRequestId }
        : {}),
      leadId: lead._id.toHexString(),
      workName: lead.workName || lead.name,
      data: await this.withItemDimensions(data),
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
    const creationHash = createHash("sha256")
      .update(JSON.stringify([record.leadId, actor, data]))
      .digest("hex");
    const saved = await this.collection.findOneAndUpdate(
      { _id: record._id },
      { $setOnInsert: { ...record, creationHash } },
      { upsert: true, returnDocument: "after" },
    );
    if (saved?.creationHash !== creationHash)
      throw new ConflictException("La guía ya se registró con otros datos.");
    return view(saved);
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
    const data = await this.withItemDimensions(
      parse(dispatchSchema, input),
      doc.data.items,
    );
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
    const data = await this.withItemDimensions(
      parse(dispatchSchema, input),
      doc.data.items,
    );
    return this.change(doc, version, editable, { data }, actor, "edit");
  }

  async submit(leadId: string, id: string, version: number, actor: string) {
    return this.gate.run(leadId, `submit:${id}:${version}`, () =>
      this.submitRecord(leadId, id, version, actor),
    );
  }
  private async submitRecord(
    leadId: string,
    id: string,
    version: number,
    actor: string,
  ) {
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

  async discard(
    id: string,
    version: number,
    observation: string,
    actor: string,
    leadId?: string,
  ) {
    const doc = leadId
      ? await this.operationsDraft(leadId, id)
      : await this.get(id);
    return this.change(
      doc,
      version,
      ["draft", "review", "returned", "rejected"],
      { status: "discarded", observation },
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
    return this.gate.run(doc.leadId, `issue-guide:${id}:${version}`, () =>
      this.issueRecord(id, version, actor),
    );
  }
  private async issueRecord(id: string, version: number, actor: string) {
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
    const attemptContext = {
      startedAt: new Date().toISOString(),
      scope: fiscalAttemptScope,
      issueDate: limaDate(),
      series: config.APISUNAT_GUIDE_SERIES,
    };
    const locked = await this.change(
      doc,
      version,
      [ready],
      {
        status: "sending",
        attemptKey,
        attemptContext,
        externalId: "",
        guideNumber: "",
      },
      actor,
    );
    return this.sendGuide(
      doc,
      locked.version,
      attemptKey,
      attemptContext,
      actor,
    );
  }

  private async sendGuide(
    doc: DispatchRecord,
    version: number,
    key: string,
    context: NonNullable<DispatchRecord["attemptContext"]>,
    actor: string,
    recovering = false,
  ) {
    let result: GuideResult;
    try {
      result = await this.provider.issue(
        doc.data,
        key,
        context.issueDate,
        context.series,
      );
    } catch (error) {
      const rejected =
        !recovering && error instanceof GuideRequestError && error.definitive;
      return this.change(
        doc,
        version,
        ["sending"],
        {
          status: rejected ? "rejected" : "pending",
          observation: rejected
            ? error.message
            : "No se pudo confirmar el envío. Administración debe verificarlo antes de volver a emitir.",
        },
        actor,
      );
    }
    return this.recordResult(doc, version, ["sending"], result, actor);
  }

  async check(id: string, version: number, actor: string) {
    const doc = await this.get(id);
    if (!view(doc).canCheckStatus || doc.version !== version)
      throw new ConflictException(
        "Este envío no se puede consultar desde el panel.",
      );
    if (!doc.externalId) {
      const { attemptKey, attemptContext } = doc;
      if (!attemptKey || !attemptContext)
        throw new ConflictException(
          "Este envío no se puede recuperar desde el panel.",
        );
      const locked = await this.change(
        doc,
        version,
        [doc.status],
        { status: "sending" },
        actor,
      );
      return this.sendGuide(
        doc,
        locked.version,
        attemptKey,
        attemptContext,
        actor,
        true,
      );
    }
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
    return this.recordResult(doc, version, [doc.status], result, actor);
  }

  async stockLines(items: DispatchInput["items"]) {
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

  async depart(
    leadId: string,
    id: string,
    actor: string,
    reservationKey?: string,
  ) {
    return this.gate.run(leadId, `departure:${id.toLowerCase()}`, () =>
      this.departRecord(leadId, id, actor, reservationKey),
    );
  }
  private async departRecord(
    leadId: string,
    id: string,
    actor: string,
    reservationKey?: string,
  ) {
    const row = await this.get(id, leadId);
    if (row.demo || !accepted.includes(row.status))
      throw new ConflictException(
        "Confirma la salida con una guía emitida para una obra real.",
      );
    const departureAttempt = reservationKey
      ? await this.supplies.deliveryAttempt(String(row._id), reservationKey)
      : undefined;
    if (reservationKey && !departureAttempt)
      throw new ConflictException("Reabre la entrega desde su solicitud.");
    // A guide has one permanent departure route. Claiming it atomically keeps a
    // direct departure and a reserved delivery from racing on the same ledger IDs.
    const source =
      reservationKey &&
      row.departureSource &&
      (await this.supplies.isLinked(String(row._id), reservationKey))
        ? row.departureSource
        : reservationKey || "direct";
    const claimed = await this.collection.findOneAndUpdate(
      {
        _id: row._id,
        $expr: {
          $eq: [{ $ifNull: ["$departureEpoch", 0] }, row.departureEpoch || 0],
        },
        $or: [
          { departureSource: { $exists: false } },
          { departureSource: source },
        ],
      },
      { $set: { departureSource: source } },
      { returnDocument: "after" },
    );
    if (!claimed)
      throw new ConflictException(
        "Confirma esta salida desde el recorrido donde se inició.",
      );
    if (row.departedAt) {
      if (
        reservationKey &&
        !(await this.inventory.ledger.findOne({
          dispatchId: id,
          reservationKey,
        }))
      )
        throw new ConflictException(
          "La guía ya salió por otro recorrido. Revisa la entrega.",
        );
      await this.supplies.recoverLegacy(
        String(row._id),
        row.leadId,
        reservationKey,
      );
      await this.supplies.release(String(row._id));
      return view(row);
    }
    const stockLines = await this.stockLines(row.data.items);
    const batch = await this.supplies.prepare(
      String(row._id),
      row.leadId,
      stockLines,
      actor,
      reservationKey,
    );
    const lines = this.supplies.pieces(batch);
    const legacyPieces = new Set<string>();
    for (const item of lines) {
      const legacy = item.reservationKey
        ? await this.inventory.ledger.findOne({
            _id: `${item.materialId}:${stableOperation(`dispatch:${row._id}:${item.materialId}`)}`,
            dispatchId: String(row._id),
            reservationKey: item.reservationKey,
            leadId: row.leadId,
          })
        : null;
      if (
        legacy &&
        Math.round(legacy.quantity * 1000) === Math.round(item.quantity * 1000)
      ) {
        legacyPieces.add(item.operationId);
        continue;
      }
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
      if (legacyPieces.has(item.operationId)) continue;
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
        {
          dispatchId: String(row._id),
          ...(item.reservationKey
            ? { reservationKey: item.reservationKey }
            : {}),
        },
      );
    }
    await this.supplies.complete(batch);
    const at = new Date().toISOString();
    await this.collection.updateOne(
      { _id: row._id, departedAt: { $exists: false } },
      {
        $set: { departedAt: at },
        $unset: { activeSupplyRequestId: "" },
        $inc: { version: 1 },
        $push: { events: { action: "depart", actor, at } },
      },
    );
    await this.supplies.release(String(row._id));
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
        | "attemptContext"
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
        ...(set.status === "discarded"
          ? { $unset: { activeSupplyRequestId: "" as const } }
          : {}),
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
