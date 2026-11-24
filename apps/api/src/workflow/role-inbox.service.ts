import { Injectable } from "@nestjs/common";
import type { Document } from "mongodb";
import {
  LEAD_STAGES,
  type InboxItem,
  type InboxSection,
  type SessionUser,
} from "@veca/content";
import { Database } from "../database/database.module";
import { WorkAccess } from "../crm/work-access.service";
@Injectable()
export class RoleInbox {
  constructor(
    private readonly db: Database,
    private readonly access: WorkAccess,
  ) {}
  private async queue(
    key: string,
    title: string,
    collection: string,
    pipeline: Document[],
    href: string,
    mapper: (row: Document) => InboxItem,
  ): Promise<InboxSection> {
    const [result] = await this.db.db
      .collection(collection)
      .aggregate<{ total: { count: number }[]; items: Document[] }>([
        ...pipeline,
        {
          $facet: {
            total: [{ $count: "count" }],
            items: [
              { $sort: { updatedAt: 1, createdAt: 1, _id: 1 } },
              { $limit: 6 },
            ],
          },
        },
      ])
      .toArray();
    return {
      key,
      title,
      href,
      count: result?.total[0]?.count || 0,
      items: (result?.items || []).map(mapper),
    };
  }
  async forUser(user: SessionUser) {
    const can = (permission: SessionUser["permissions"][number]) =>
      user.permissions.includes(permission);
    const sections: Promise<InboxSection>[] = [];
    const workHref = (row: Document) => `#works/${row._id}`;
    const workScope = this.access.scope(user);
    if (can("works")) {
      if (can("works_manage")) {
        sections.push(
          this.queue(
            "handoffs",
            "Entregas a Operaciones",
            "crm_leads",
            [
              {
                $match: {
                  ...workScope,
                  "workHandoff.status": "submitted",
                  "workAssignment.coordinatorId": user.id,
                },
              },
            ],
            "#works",
            (row) => ({
              id: String(row._id),
              title: row.name,
              detail: "Pendiente de tu aceptación",
              href: workHref(row),
            }),
          ),
        );
        sections.push(
          this.queue(
            "stage_requests",
            "Solicitudes de avance",
            "crm_leads",
            [
              {
                $match: {
                  ...workScope,
                  "stageRequest.status": "pending",
                  "workAssignment.coordinatorId": user.id,
                },
              },
            ],
            "#works",
            (row) => ({
              id: String(row._id),
              title: row.name,
              detail: `${row.stageRequest.requestedName} solicita pasar a ${LEAD_STAGES.find((stage) => stage.id === row.stageRequest.to)?.name}`,
              href: workHref(row),
            }),
          ),
        );
        sections.push(
          this.queue(
            "reviews",
            "Revisiones finales solicitadas",
            "crm_leads",
            [
              {
                $match: {
                  ...workScope,
                  stage: "execution",
                  stageRequest: { $exists: false },
                  "workAssignment.coordinatorId": user.id,
                  completionReview: { $ne: null, $exists: true },
                },
              },
            ],
            "#works",
            (row) => ({
              id: String(row._id),
              title: row.name,
              detail: "Revisar pendientes y cerrar la obra",
              href: workHref(row) + "/closeout",
            }),
          ),
        );
      }
      if (can("works_manage") || can("works_report")) {
        sections.push(
          this.queue(
            "stage_returns",
            "Avances por corregir",
            "crm_leads",
            [
              {
                $match: {
                  ...workScope,
                  "stageRequest.status": "returned",
                  "stageRequest.requestedBy": user.id,
                },
              },
            ],
            "#works",
            (row) => ({
              id: String(row._id),
              title: row.name,
              detail: row.stageRequest.observation,
              href: workHref(row),
            }),
          ),
        );
        sections.push(
          this.queue(
            "tasks",
            can("works_manage") ? "Pendientes de las obras" : "Mis pendientes",
            "crm_leads",
            [
              {
                $match: {
                  ...workScope,
                  stage: { $in: ["coordination", "execution"] },
                },
              },
              { $unwind: "$workTasks" },
              {
                $match: {
                  "workTasks.status": { $ne: "done" },
                  ...(!can("works_manage")
                    ? { "workTasks.assignedTo": user.id }
                    : {}),
                },
              },
            ],
            "#works",
            (row) => ({
              id: String(row._id) + row.workTasks.id,
              title: row.workTasks.title,
              detail: `${row.name} · ${row.workTasks.assignedName} · ${row.workTasks.status === "blocked" ? "Bloqueado: " + row.workTasks.observation : row.workTasks.dueDate}`,
              href: workHref(row) + "/tasks",
            }),
          ),
        );
        sections.push(
          this.queue(
            "receipts",
            "Materiales por confirmar en obra",
            "supply_requests",
            [
              { $match: { $expr: { $gt: ["$delivered", "$received"] } } },
              {
                $lookup: {
                  from: "crm_leads",
                  let: { work: "$workId" },
                  pipeline: [
                    {
                      $match: {
                        ...workScope,
                        $expr: { $eq: [{ $toString: "$_id" }, "$$work"] },
                      },
                    },
                  ],
                  as: "work",
                },
              },
              { $match: { "work.0": { $exists: true } } },
            ],
            "#works",
            (row) => ({
              id: String(row._id),
              title: row.materialName,
              detail: `${row.workName} · Recibido ${row.received} de ${row.delivered}`,
              href: `#works/${row.workId}/supplies`,
            }),
          ),
        );
      }
    }
    if (can("leads"))
      sections.push(
        this.queue(
          "leads",
          "Seguimiento comercial",
          "crm_leads",
          [
            {
              $match: {
                $or: [
                  { stage: "prelead" },
                  { "workHandoff.status": "returned" },
                ],
              },
            },
          ],
          "#leads",
          (row) => ({
            id: String(row._id),
            title: row.name,
            detail:
              row.workHandoff?.status === "returned"
                ? `Entrega devuelta: ${row.workHandoff.observation}`
                : "Primer contacto pendiente",
            href: `#leads/${row._id}`,
          }),
        ),
      );
    if (can("inventory")) {
      if (can("inventory_reserve") || can("inventory_request"))
        sections.push(
          this.queue(
            "supplies",
            "Solicitudes por abastecer",
            "supply_requests",
            [
              {
                $match: {
                  cancelled: false,
                  $expr: {
                    $gt: ["$quantity", { $add: ["$delivered", "$reserved"] }],
                  },
                },
              },
            ],
            "#inventory/solicitudes",
            (row) => ({
              id: String(row._id),
              title: row.materialName,
              detail: `${row.workName} · Necesario el ${row.neededBy}`,
              href: `#inventory/solicitudes/${row._id}`,
            }),
          ),
        );
      if (can("inventory_dispatch"))
        sections.push(
          this.queue(
            "dispatch",
            "Reservas por entregar",
            "supply_requests",
            [{ $match: { reserved: { $gt: 0 }, cancelled: false } }],
            "#inventory/solicitudes",
            (row) => ({
              id: String(row._id),
              title: row.materialName,
              detail: `${row.workName} · Reservado ${row.reserved}`,
              href: "#inventory/solicitudes",
            }),
          ),
        );
      if (can("inventory_receive"))
        sections.push(
          this.queue(
            "returns",
            "Devoluciones a Almacén",
            "supply_requests",
            [{ $match: { returnRequested: { $gt: 0 } } }],
            "#inventory/solicitudes",
            (row) => ({
              id: String(row._id),
              title: row.materialName,
              detail: `${row.workName} · Por recibir ${row.returnRequested}`,
              href: "#inventory/solicitudes",
            }),
          ),
        );
      if (can("purchases_manage"))
        sections.push(
          this.queue(
            "purchases",
            "Compras solicitadas",
            "warehouse_purchases",
            [
              {
                $match: {
                  requestedOnly: true,
                  orderedAt: { $exists: false },
                  cancelled: { $ne: true },
                },
              },
            ],
            "#inventory/compras",
            (row) => ({
              id: String(row._id),
              title: row.workName || "Compra de materiales",
              detail: row.reason || "Registrar compra del faltante",
              href: `#inventory/compras/${row._id}`,
            }),
          ),
        );
      if (can("inventory_equipment"))
        sections.push(
          this.queue(
            "equipment",
            "Equipos por devolver",
            "warehouse_equipment",
            [
              {
                $match: {
                  assignment: { $ne: null },
                  "assignment.expectedReturn": {
                    $lte: new Intl.DateTimeFormat("en-CA", {
                      timeZone: "America/Lima",
                    }).format(new Date()),
                  },
                },
              },
            ],
            "#inventory/equipos",
            (row) => ({
              id: String(row._id),
              title: row.name,
              detail: `${row.assignment.workName} · ${row.assignment.responsible}`,
              href: `#inventory/equipos/${row._id}`,
            }),
          ),
        );
    }
    if (can("accounting")) {
      sections.push(
        this.queue(
          "fiscal",
          "Guías por revisar",
          "dispatches",
          [
            {
              $match: {
                status: { $in: ["review", "sending", "pending", "rejected"] },
              },
            },
          ],
          "#accounting/guias/revision",
          (row) => ({
            id: String(row._id),
            title: row.workName,
            detail: row.observation || "Revisión fiscal pendiente",
            href: `#accounting/guias/${row._id}`,
          }),
        ),
      );
      sections.push(
        this.queue(
          "invoices",
          "Facturas solicitadas",
          "accounting_invoices",
          [{ $match: { status: "requested" } }],
          "#accounting/facturas/solicitadas",
          (row) => ({
            id: String(row._id),
            title: row.workName,
            detail: "Completar datos de facturación",
            href: `#accounting/facturas/${row._id}`,
          }),
        ),
      );
      sections.push(
        this.queue(
          "collections",
          "Cobros pendientes",
          "accounting_invoices",
          [
            {
              $match: {
                status: { $in: ["accepted", "observed"] },
                $expr: { $gt: ["$totalCents", "$paidCents"] },
              },
            },
          ],
          "#accounting/facturas/por-cobrar",
          (row) => ({
            id: String(row._id),
            title: row.workName,
            detail: "Factura con saldo por cobrar",
            href: `#accounting/facturas/${row._id}`,
          }),
        ),
      );
      sections.push(
        this.queue(
          "proofs",
          "Gastos por sustentar o revisar",
          "accounting_costs",
          [
            {
              $match: {
                $or: [
                  { reviewed: { $ne: true } },
                  { proofKey: { $exists: false } },
                ],
              },
            },
          ],
          "#accounting/gastos",
          (row) => ({
            id: String(row._id),
            title: row.supplier || row.description || "Gasto de obra",
            detail: row.supplier || "Revisar documento de gasto",
            href: "#accounting/gastos",
          }),
        ),
      );
    }
    return Promise.all(sections);
  }
}
