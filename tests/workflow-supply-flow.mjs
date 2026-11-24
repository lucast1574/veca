import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import {
  crmLeadDefaults,
  dispatchSchema,
  leadUpdateSchema,
} from "@veca/content";

const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local-only fixtures");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const tag = "workflow-" + randomUUID();
const people = Object.fromEntries(
  [
    "operations",
    "worker",
    "other",
    "warehouse",
    "purchasing",
    "accounting",
    "action_only",
  ].map((role) => [role, new ObjectId()]),
);
const workId = String(new ObjectId()),
  otherId = String(new ObjectId());
const materials = [],
  requests = [],
  guides = [];
async function call(path, session, method = "GET", body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(session
        ? { Cookie: session.cookie, "X-Veca-Csrf": session.csrf }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert(
    (Array.isArray(status) ? status : [status]).includes(response.status),
    `${method} ${path}: expected ${status}, got ${response.status}: ${JSON.stringify(data)}`,
  );
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const get = async (path, session, status = 200) =>
  (await call(path, session, "GET", undefined, status)).data;
const post = async (path, session, body, status = 201) =>
  (await call(path, session, "POST", body, status)).data;
const put = async (path, session, body, status = 200) =>
  (await call(path, session, "PUT", body, status)).data;
const sessions = {};
const root = `/admin/works/${workId}`;
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  await db.collection("roles").insertOne({
    id: tag,
    name: "Only action",
    permissions: ["inventory_catalog", "inventory_receive", "purchases_manage"],
    revision: 1,
  });
  for (const [role, id] of Object.entries(people)) {
    await db.collection("users").insertOne({
      _id: id,
      username: tag + role,
      name: role,
      role: role === "other" ? "worker" : role === "action_only" ? tag : role,
      status: "active",
      emailVerified: true,
      passwordHash: admin.passwordHash,
    });
  }
  for (const role of ["admin", ...Object.keys(people)]) {
    const result = await call(
      "/auth/login",
      null,
      "POST",
      {
        username: role === "admin" ? "admin" : tag + role,
        password: "Local-only-visual-test-2026!",
      },
      201,
    );
    sessions[role] = { cookie: result.cookie, csrf: result.data.csrf };
  }
  for (const id of [workId, otherId]) {
    await db.collection("crm_leads").insertOne({
      ...crmLeadDefaults,
      _id: new ObjectId(id),
      name: tag,
      submissionId: randomUUID(),
      source: "manual",
      stage: "execution",
      version: 1,
      email: "",
      phone: "999111222",
      district: "San Luis",
      idea: "Instalar mamparas y sellar juntas.",
      requestType: "home",
      segment: "low",
      contactResult: "Contacto confirmado.",
      appointment: "2030-01-02T08:00:00-05:00",
      address: "Av. San Luis 123",
      workPlan: "Instalación de mamparas.",
      workHandoff: { status: "accepted" },
      workAssignment: {
        coordinatorId: String(people.operations),
        coordinatorName: "operations",
        participantIds: [String(id === workId ? people.worker : people.other)],
        participantNames: [id === workId ? "worker" : "other"],
      },
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const taskId = randomUUID();
  const taskBody = {
    id: taskId,
    version: 1,
    title: "Sellar las juntas de la mampara",
    assignedTo: String(people.worker),
    dueDate: "2030-02-01",
  };
  await post(root + "/tasks", sessions.worker, taskBody, 403);
  await post(
    root + "/tasks",
    sessions.operations,
    { ...taskBody, assignedTo: String(people.other) },
    403,
  );
  let work = await post(root + "/tasks", sessions.operations, taskBody);
  assert.equal(work.workTasks[0].assignedName, "worker");
  await get(root + "/tasks", sessions.other, 404);
  await put(
    root + "/tasks/" + taskId,
    sessions.accounting,
    { version: work.version, status: "done" },
    403,
  );
  await put(
    root + "/tasks/" + taskId,
    sessions.worker,
    { version: work.version, status: "blocked", observation: "" },
    400,
  );
  await put(
    root + "/tasks/" + taskId,
    sessions.worker,
    {
      version: work.version,
      status: "done",
      assignedTo: String(people.operations),
    },
    403,
  );
  work = await put(root + "/tasks/" + taskId, sessions.worker, {
    version: work.version,
    status: "blocked",
    observation: "Falta sellador de juntas.",
  });
  await post(
    root + "/completion-review",
    sessions.worker,
    { version: work.version, note: "Instalación lista para la revisión." },
    409,
  );
  const workInput = Object.fromEntries(
    Object.keys(leadUpdateSchema.shape).map((key) => [key, work[key]]),
  );
  await put(
    root,
    sessions.operations,
    {
      ...workInput,
      version: work.version,
      stage: "completed",
      completionNote: "Instalación revisada.",
    },
    409,
  );
  work = await put(root + "/tasks/" + taskId, sessions.operations, {
    version: work.version,
    status: "pending",
    assignedTo: String(people.operations),
  });
  await put(
    root + "/tasks/" + taskId,
    sessions.worker,
    { version: work.version, status: "done" },
    403,
  );
  work = await put(root + "/tasks/" + taskId, sessions.operations, {
    version: work.version,
    status: "done",
  });
  work = await post(root + "/completion-review", sessions.operations, {
    version: work.version,
    note: "Instalación lista para revisión final.",
  });
  assert(work.completionReview);
  await put(
    root + "/tasks/" + taskId,
    sessions.operations,
    { version: work.version - 1, status: "pending" },
    409,
  );
  work = await put(root + "/tasks/" + taskId, sessions.operations, {
    version: work.version,
    status: "pending",
  });
  assert.equal(work.completionReview, null);

  const materialBody = {
    sku: tag,
    name: "Sellador QA",
    unit: "unit",
    category: "Selladores",
    location: "A1",
    minimum: 1,
    description: "Solo QA",
  };
  await post("/admin/crm/materials", sessions.action_only, materialBody, 403);
  const material = await post(
    "/admin/crm/materials",
    sessions.admin,
    materialBody,
  );
  materials.push(material.id);
  const materialPath = "/admin/crm/materials/" + material.id;
  const receipt = (quantity) =>
    post(materialPath + "/movements", sessions.warehouse, {
      operationId: randomUUID(),
      kind: "receipt",
      leadId: null,
      quantity,
      reason: "Entrada QA de selladores.",
    });
  await receipt(20.5);
  const input = {
    id: String(new ObjectId()),
    materialId: material.id,
    quantity: 10.5,
    neededBy: "2030-01-05",
    reason: "Sellar las juntas de las mamparas.",
  };
  await post(root + "/supplies", sessions.worker, input, 403);
  await post(`/admin/works/${otherId}/supplies`, sessions.worker, input, 403);
  let request = await post(root + "/supplies", sessions.operations, input);
  requests.push(request.id);
  const actionsPath = "/admin/supply-requests/" + request.id + "/actions";
  const action = async (
    name,
    quantity = 0,
    user = sessions.warehouse,
    extra = {},
    status = 201,
  ) => {
    const result = await post(
      actionsPath,
      user,
      {
        operationId: randomUUID(),
        version: request.version,
        action: name,
        quantity,
        note: "",
        ...extra,
      },
      status,
    );
    if (status === 201) request = result;
    return result;
  };
  await action("reserve", 6.1, sessions.accounting, {}, 403);
  await action("reserve", 6.1);
  let stock = await get(materialPath, sessions.admin);
  assert.equal(stock.balance, 20.5);
  assert.equal(stock.reserved, 6.1);
  assert.equal(stock.available, 14.4);
  await post(
    materialPath + "/movements",
    sessions.operations,
    {
      operationId: randomUUID(),
      kind: "consumption",
      quantity: 15,
      leadId: workId,
      reason: "No debe consumir la reserva.",
    },
    409,
  );
  await post(
    `/admin/warehouse/materials/${material.id}/count`,
    sessions.admin,
    {
      operationId: randomUUID(),
      version: stock.version,
      counted: 5,
      reason: "Conteo por debajo de las reservas.",
    },
    409,
  );
  const competing = await post(
    `/admin/works/${otherId}/supplies`,
    sessions.operations,
    { ...input, id: String(new ObjectId()), quantity: 20 },
  );
  requests.push(competing.id);
  const retryReservation = {
    operationId: randomUUID(),
    version: competing.version,
    action: "reserve",
    quantity: 20,
    note: "",
  };
  await post(
    `/admin/supply-requests/${competing.id}/actions`,
    sessions.warehouse,
    retryReservation,
    409,
  );
  await receipt(10);
  const retried = await post(
    `/admin/supply-requests/${competing.id}/actions`,
    sessions.warehouse,
    retryReservation,
  );
  assert.equal(retried.reserved, 20);
  await post(
    `/admin/supply-requests/${competing.id}/actions`,
    sessions.warehouse,
    {
      operationId: randomUUID(),
      version: retried.version,
      action: "cancel",
      quantity: 0,
      note: "",
    },
  );
  await action("purchase");
  const purchase = await get(
    "/admin/warehouse/purchases/" + request.purchaseId,
    sessions.purchasing,
  );
  assert.equal(purchase.items[0].requested, 4.4);
  assert.equal(purchase.workId, workId);
  await post("/admin/warehouse/purchases", sessions.warehouse, {}, 403);
  await post("/admin/warehouse/purchases", sessions.action_only, {}, 403);

  async function guide(work = workId, quantity = 3.1) {
    const id = String(new ObjectId());
    guides.push(id);
    await db.collection("dispatches").insertOne({
      _id: new ObjectId(id),
      leadId: work,
      workName: tag,
      demo: false,
      status: "accepted",
      version: 1,
      guideNumber: "T001-QA",
      observation: "",
      data: dispatchSchema.parse({
        startAddress: "Almacén VECA",
        startUbigeo: "150134",
        arrivalAddress: "Av. San Luis 123",
        arrivalUbigeo: "150134",
        transferAt: "2030-01-02T08:00",
        motiveCode: "13",
        motiveDescription: "Instalación",
        recipientType: "6",
        recipientNumber: "20616656156",
        recipientName: "VECA QA",
        transportMode: "02",
        carrierRuc: "",
        carrierName: "",
        vehiclePlate: "ABC123",
        driverDocument: "12345678",
        driverName: "Juan",
        driverLastName: "Pérez",
        driverLicense: "Q12345678",
        weightKg: 20,
        items: [
          {
            materialId: material.id,
            code: material.sku,
            description: material.name,
            unitCode: "NIU",
            quantity,
          },
        ],
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    });
    return id;
  }
  const wrongGuide = await guide(otherId);
  await action(
    "deliver",
    3.1,
    sessions.warehouse,
    { guideId: wrongGuide },
    400,
  );
  const guideId = await guide();
  assert(
    (
      await get(
        `/admin/supply-requests/${request.id}/guides`,
        sessions.warehouse,
      )
    ).some((row) => row.id === guideId),
  );
  const delivery = {
    operationId: randomUUID(),
    version: request.version,
    action: "deliver",
    quantity: 3.1,
    guideId,
    note: "Salida de selladores.",
  };
  await Promise.all([
    post(actionsPath, sessions.warehouse, delivery, [201, 409]),
    post(actionsPath, sessions.warehouse, delivery, [201, 409]),
  ]);
  request = await post(actionsPath, sessions.warehouse, delivery);
  assert.equal(request.delivered, 3.1);
  assert.equal(request.reserved, 3);
  stock = await get(materialPath, sessions.admin);
  assert.equal(stock.balance, 27.4);
  assert.equal(stock.reserved, 3);
  assert.equal(
    await db
      .collection("inventory_movements")
      .countDocuments({ dispatchId: guideId }),
    1,
  );
  await post(
    `/admin/crm/leads/${workId}/dispatches/${guideId}/depart`,
    sessions.warehouse,
    {},
    409,
  );
  const workAction = async (name, quantity, status = 201) => {
    const result = await post(
      root + `/supplies/${request.id}/actions`,
      sessions.worker,
      {
        operationId: randomUUID(),
        version: request.version,
        action: name,
        quantity,
        note: "Recibido en obra.",
      },
      status,
    );
    if (status === 201) request = result;
  };
  await workAction("receive", 4, 400);
  await workAction("reserve", 1, 403);
  await workAction("receive", 3.1);
  await workAction("request_return", 1.1);
  const returning = {
    operationId: randomUUID(),
    version: request.version,
    action: "accept_return",
    quantity: 1.1,
    note: "Sellador sobrante en buen estado.",
  };
  request = await post(actionsPath, sessions.warehouse, returning);
  request = await post(actionsPath, sessions.warehouse, returning);
  assert.equal(request.returned, 1.1);
  assert.equal(request.returnRequested, 0);
  stock = await get(materialPath, sessions.admin);
  assert.equal(stock.balance, 28.5);
  await action("cancel");
  assert.equal(request.cancelled, true);
  assert.equal(request.reserved, 0);
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27099";
  process.env.NODE_ENV = "test";
  const { InventoryService } =
    await import("../apps/api/dist/inventory/inventory.service.js");
  const inventory = new InventoryService({ db }, {}, { emit() {} });
  await inventory.reserve(material.id, request.id, workId, 6.1, 1);
  assert.equal(
    (await get(materialPath, sessions.admin)).reserved,
    0,
    "a delayed reserve cannot restore a cancelled reservation",
  );
  await workAction("request_return", 1);
  await action("accept_return", 1);
  assert.equal(request.returned, 2.1);
  await action("reserve", 1, sessions.warehouse, {}, 409);
  await get(`/admin/works/${otherId}/supplies`, sessions.worker, 404);
  const page = await get(
    "/admin/supply-requests?filter=all",
    sessions.warehouse,
  );
  assert(page.items.some((row) => row.id === request.id));
  console.log(
    "PASS tasks, worker scope, action permissions, reservations, shortage purchase, accepted-guide delivery, receipt and idempotent return",
  );
} finally {
  await db
    .collection("users")
    .deleteMany({ _id: { $in: Object.values(people) } });
  await db.collection("roles").deleteOne({ id: tag });
  await db.collection("crm_leads").deleteMany({
    _id: { $in: [workId, otherId].map((id) => new ObjectId(id)) },
  });
  await db
    .collection("inventory_materials")
    .deleteMany({ _id: { $in: materials.map((id) => new ObjectId(id)) } });
  await db
    .collection("inventory_movements")
    .deleteMany({ materialId: { $in: materials } });
  await db
    .collection("supply_requests")
    .deleteMany({ _id: { $in: requests.map((id) => new ObjectId(id)) } });
  await db
    .collection("warehouse_purchases")
    .deleteMany({ workId: { $in: [workId, otherId] } });
  await db
    .collection("dispatches")
    .deleteMany({ _id: { $in: guides.map((id) => new ObjectId(id)) } });
  await client.close();
}
