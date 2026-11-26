import { http, HttpResponse } from "msw";
import {
  MATERIAL_CATEGORIES,
  materialSchema,
  type Material,
  type Movement,
  type Purchase,
  type SupplyRequest,
  type WorkCloseout,
  type WorkFinancials,
  type WorkSupply,
} from "@veca/content";
import { margin, tasks, user, works } from "./fixtures";
const at = "2026-11-25T14:00:00.000Z";
export const materials: Material[] = [
  {
    id: "bbbbbbbbbbbbbbbbbbbbbbb1",
    sku: "VID-T10",
    name: "Vidrio templado de 10 mm",
    unit: "m2",
    category: MATERIAL_CATEGORIES[0],
    location: "Zona A · Rack 2",
    description: "Paños para fachada",
    minimum: 10,
    balance: 36,
    reserved: 8,
    available: 28,
    unitCostCents: 47000,
    version: 3,
    updatedAt: at,
  },
  {
    id: "bbbbbbbbbbbbbbbbbbbbbbb2",
    sku: "HER-INOX",
    name: "Kit de herrajes de acero inoxidable",
    unit: "unit",
    category: "Herrajes",
    location: "Estante B · Nivel 1",
    description: "Anclajes y accesorios de instalación",
    minimum: 6,
    balance: 4,
    reserved: 4,
    available: 0,
    unitCostCents: 12500,
    version: 2,
    updatedAt: at,
  },
];
export const stockMovements: Movement[] = [
  {
    id: "demo-glass-receipt",
    materialId: materials[0].id,
    materialName: materials[0].name,
    unit: materials[0].unit,
    leadId: null,
    kind: "receipt",
    quantity: 12,
    reason: "Recepción de paños de vidrio del proveedor",
    actor: "Jorge Quispe",
    at,
    balanceAfter: 36,
  },
  {
    id: "demo-glass-dispatch",
    materialId: materials[0].id,
    materialName: materials[0].name,
    unit: materials[0].unit,
    leadId: works[0].id,
    kind: "dispatch",
    quantity: 16,
    reason: "Salida para la fachada de Edificio Alameda",
    actor: "Jorge Quispe",
    at: "2026-11-24T14:00:00.000Z",
    balanceAfter: 24,
  },
  {
    id: "demo-hardware-receipt",
    materialId: materials[1].id,
    materialName: materials[1].name,
    unit: materials[1].unit,
    leadId: null,
    kind: "receipt",
    quantity: 4,
    reason: "Recepción parcial de kits para instalación",
    actor: "Jorge Quispe",
    at: "2026-11-23T14:00:00.000Z",
    balanceAfter: 4,
  },
];

export const supplies: SupplyRequest[] = materials.map((m, i) => ({
  id: i ? "ccccccccccccccccccccccc2" : "ccccccccccccccccccccccc1",
  materialId: m.id,
  workId: works[0].id,
  workName: works[0].workName,
  quantity: i ? 12 : 24,
  neededBy: "2026-11-27",
  reason: i
    ? "Herrajes para terminar el frente norte. Faltan 8 kits del proveedor."
    : "Paños para instalar la fachada del piso 4. Entrega coordinada con Luis Medina.",
  materialName: m.name,
  sku: m.sku,
  unit: m.unit,
  available: m.available,
  version: 2,
  reserved: i ? 4 : 8,
  delivered: i ? 0 : 16,
  received: i ? 0 : 16,
  returnRequested: 0,
  returned: 0,
  cancelled: false,
  createdAt: at,
  requestedBy: "222222222222222222222222",
  requestedByName: "Luis Medina",
  operations: [],
}));
const orderBase = {
  workId: works[0].id,
  workName: works[0].workName,
  createdAt: at,
  actor: user.name,
  supplier: "Cristales del Pacífico · Ejemplo",
  supplierRuc: "20100000002",
  reason: "Paños de vidrio para la fachada del piso 4",
  receipts: [],
};
const line = {
  materialId: materials[0].id,
  name: materials[0].name,
  sku: materials[0].sku,
  unit: materials[0].unit,
  requested: 12,
  ordered: 12,
  received: 0,
  unitCents: 47000,
  reason: "Completar frente norte y dejar repuestos para la instalación",
};
export const orders: Purchase[] = [
  {
    ...orderBase,
    id: "ddddddddddddddddddddddd1",
    status: "requested",
    items: [],
    requestedAt: at,
    requestedBy: user.name,
    invoiceSource: {
      costId: "eeeeeeeeeeeeeeeeeeeeeee1",
      reference: "F001-1208",
      netCents: 564000,
      taxCents: 101520,
    },
  },
  {
    ...orderBase,
    id: "ddddddddddddddddddddddd2",
    status: "partial",
    items: [{ ...line, received: 8 }],
    receipts: [
      {
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
        materialId: materials[0].id,
        quantity: 8,
        reference: "Guía T001-000184",
        at,
        actor: "Jorge Quispe",
        applied: true,
      },
    ],
  },
  {
    ...orderBase,
    id: "ddddddddddddddddddddddd3",
    status: "received",
    items: [{ ...line, received: 12 }],
    receipts: [
      {
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
        materialId: materials[0].id,
        quantity: 12,
        reference: "Guía T001-000185",
        at,
        actor: "Jorge Quispe",
        applied: true,
      },
    ],
  },
];
export const closeout: WorkCloseout = {
  stage: "execution",
  ready: false,
  checks: [
    { key: "tasks", label: "Tareas por completar", count: 4, blocking: true },
    {
      key: "requests",
      label: "Solicitudes de materiales pendientes",
      count: 2,
      blocking: true,
    },
    {
      key: "returns",
      label: "Devoluciones por recibir",
      count: 0,
      blocking: true,
    },
    {
      key: "equipment",
      label: "Equipos por devolver",
      count: 2,
      blocking: true,
    },
    { key: "guides", label: "Guías por confirmar", count: 1, blocking: true },
    {
      key: "costs",
      label: "Comprobantes por revisar",
      count: 1,
      blocking: false,
    },
  ],
};
const financials: WorkFinancials = {
  margin,
  counts: { invoices: 2, costs: 3, guides: 2 },
  invoices: [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee2",
      number: "F001-00042",
      status: "accepted",
      total: 14160000,
      paid: 11800000,
    },
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee3",
      number: "F001-00051",
      status: "accepted",
      total: 7080000,
      paid: 3000000,
    },
  ],
  costs: [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee4",
      supplier: "Cristales del Pacífico · F001-1208",
      reviewed: true,
      proof: true,
    },
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee5",
      supplier: "Transporte de materiales · F002-186",
      reviewed: true,
      proof: true,
    },
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee6",
      supplier: "Herrajes para fachada · F001-640",
      reviewed: false,
      proof: false,
    },
  ],
  guides: [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee7",
      number: "T001-000184",
      version: 2,
      status: "accepted",
      canOpen: true,
      departed: true,
    },
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee8",
      number: "T001-000185",
      version: 1,
      status: "review",
      canOpen: true,
      departed: false,
    },
  ],
};
const plan: WorkSupply = {
  plan: {
    revision: 3,
    budgetCents: 14000000,
    materials: materials.map((m) => ({
      materialId: m.id,
      quantity: m.id === materials[0].id ? 48 : 24,
    })),
    equipment: [],
  },
  materials: materials.map((m, i) => ({
    materialId: m.id,
    sku: m.sku,
    name: m.name,
    unit: m.unit,
    planned: i ? 24 : 48,
    requested: i ? 12 : 24,
    ordered: i ? 8 : 24,
    received: i ? 0 : 20,
    delivered: i ? 0 : 16,
    consumed: i ? 0 : 12,
    returned: 0,
  })),
  equipment: [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeee9",
      code: "EQ-014",
      name: "Ventosa de elevación",
      assigned: true,
    },
    {
      id: "eeeeeeeeeeeeeeeeeeeeeeea",
      code: "EQ-008",
      name: "Taladro percutor",
      assigned: true,
    },
  ],
  purchases: orders
    .slice(0, 2)
    .map(({ id, supplier, status }) => ({ id, supplier, status })),
};
const base = "http://veca-storybook.invalid";
export const warehouseHandlers = [
  http.get(`${base}/admin/accounting/purchase-materials`, () =>
    HttpResponse.json(materials),
  ),
  http.post(
    `${base}/admin/accounting/purchase-materials`,
    async ({ request }) =>
      HttpResponse.json(
        {
          ...materialSchema.parse(await request.json()),
          id: "bbbbbbbbbbbbbbbbbbbbbbb3",
          balance: 0,
          available: 0,
          reserved: 0,
          version: 1,
          updatedAt: at,
        },
        { status: 201 },
      ),
  ),
  http.get(`${base}/admin/accounting/purchase-works`, () =>
    HttpResponse.json(
      works.map((w) => ({ id: w.id, name: w.workName, stage: w.stage })),
    ),
  ),
  http.get(`${base}/admin/accounting/purchase-orders`, () =>
    HttpResponse.json({
      items: orders.filter((o) => o.status === "requested"),
      hasMore: false,
    }),
  ),
  http.get(`${base}/admin/accounting/purchase-orders/:id`, ({ params }) =>
    HttpResponse.json(orders.find((o) => o.id === params.id)),
  ),
  http.get(`${base}/admin/accounting/costs`, () =>
    HttpResponse.json({ items: [], hasMore: false }),
  ),
  http.get(`${base}/admin/accounting/cost-origins`, () =>
    HttpResponse.json({ purchases: [], dispatches: [] }),
  ),
  http.get(`${base}/admin/accounting/sire/purchases`, () =>
    HttpResponse.json({
      items: [],
      total: 0,
      pending: 0,
      pendingCents: 0,
      registered: 0,
      review: 0,
      page: 1,
      hasMore: false,
      syncedAt: at,
    }),
  ),

  http.get(`${base}/admin/crm/materials`, () => HttpResponse.json(materials)),
  http.get(`${base}/admin/crm/materials/:id`, ({ params }) => {
    const material = materials.find((item) => item.id === params.id);
    return material
      ? HttpResponse.json(material)
      : HttpResponse.json(
          { message: "Material no encontrado" },
          { status: 404 },
        );
  }),
  http.get(`${base}/admin/crm/movements`, ({ request }) => {
    const materialId = new URL(request.url).searchParams.get("materialId");
    return HttpResponse.json(
      stockMovements.filter(
        (item) => !materialId || item.materialId === materialId,
      ),
    );
  }),
  http.get(`${base}/admin/warehouse/works`, () =>
    HttpResponse.json(
      works.map((w) => ({ id: w.id, name: w.workName, stage: w.stage })),
    ),
  ),
  http.get(`${base}/admin/warehouse/works/:id`, () => HttpResponse.json(plan)),
  http.get(`${base}/admin/supply-requests`, () =>
    HttpResponse.json({ items: supplies, hasMore: false }),
  ),
  http.get(`${base}/admin/works/:id/supplies`, () =>
    HttpResponse.json({ items: supplies, hasMore: false }),
  ),
  http.get(`${base}/admin/works/:id`, ({ params }) =>
    HttpResponse.json({
      lead: {
        ...works.find((work) => work.id === params.id),
        workTasks: tasks,
      },
      attachments: [],
      movements: [
        {
          id: "fffffffffffffffffffffff1",
          materialId: materials[0].id,
          materialName: materials[0].name,
          unit: materials[0].unit,
          leadId: String(params.id),
          kind: "consumption",
          quantity: 12,
          reason: "Instalación de los paños del piso 4 · Frente norte",
          actor: "Carlos Rojas",
          at,
          balanceAfter: 36,
          costCents: 564000,
        },
      ],
    }),
  ),
  http.get(`${base}/admin/warehouse/purchases`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const search = (params.get("search") || "").toLowerCase();
    return HttpResponse.json({
      items: orders.filter(
        (o) =>
          (!params.get("status") || o.status === params.get("status")) &&
          `${o.supplier} ${o.workName}`.toLowerCase().includes(search),
      ),
      hasMore: false,
    });
  }),
  http.get(`${base}/admin/warehouse/purchases/:id`, ({ params }) => {
    const row = orders.find((o) => o.id === params.id);
    return row
      ? HttpResponse.json(row)
      : HttpResponse.json(
          { message: "Pedido de ejemplo no encontrado" },
          { status: 404 },
        );
  }),
  http.get(`${base}/admin/work-control/:id/financials`, () =>
    HttpResponse.json(financials),
  ),
  http.get(`${base}/admin/work-control/:id/closeout`, () =>
    HttpResponse.json(closeout),
  ),
  http.get(`${base}/admin/crm/leads/:id/invoice-request`, () =>
    HttpResponse.json({ requested: true }),
  ),
  http.get(`${base}/admin/crm/leads/:id/dispatches`, () =>
    HttpResponse.json([
      {
        id: "eeeeeeeeeeeeeeeeeeeeeee7",
        guideNumber: "T001-000184",
        transferAt: at,
        status: "accepted",
        departedAt: at,
        arrivalAddress: "Edificio Alameda · San Borja",
        observation: "Paños del piso 4 y herrajes recibidos por Luis Medina",
        createdInAccounting: true,
      },
      {
        id: "eeeeeeeeeeeeeeeeeeeeeee8",
        guideNumber: "T001-000185",
        transferAt: "2026-11-27T14:00:00.000Z",
        status: "review",
        arrivalAddress: "Edificio Alameda · San Borja",
        observation:
          "Entrega de herrajes pendiente de revisión de Contabilidad",
        createdInAccounting: true,
      },
    ]),
  ),
];
