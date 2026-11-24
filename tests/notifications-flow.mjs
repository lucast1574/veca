import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "@veca/content";
const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local-only notification fixtures");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect(),
  db = client.db("veca_qa");
const tag = "notice-" + randomUUID(),
  workId = new ObjectId(),
  nextId = new ObjectId();
const ids = Object.fromEntries(
  ["coordinator", "replacement", "worker", "publisher", "pending"].map(
    (key) => [key, new ObjectId()],
  ),
);
const sessions = {};
async function call(path, who, method = "GET", body, status = 200) {
  const session = sessions[who];
  const r = await fetch(base + path, {
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
  const data = await r.json();
  assert.equal(
    r.status,
    status,
    `${who} ${method} ${path}: ${JSON.stringify(data)}`,
  );
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const get = async (path, who, status = 200) =>
  (await call(path, who, "GET", undefined, status)).data;
const post = async (path, who, body, status = 201) =>
  (await call(path, who, "POST", body, status)).data;
async function waitFor(check, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(message);
}
const pushMessages = async () =>
  (await fetch("http://localhost:4510/push-messages")).json();
const notice = (who, title, work = workId) =>
  waitFor(
    () =>
      db
        .collection("notifications")
        .findOne(
          { userId: String(ids[who]), workId: String(work), title },
          { sort: { createdAt: -1 } },
        ),
    `Missing ${title} for ${who}`,
  );
const delivered = (id, token) =>
  waitFor(
    async () =>
      (await pushMessages()).find((m) => m.data.id === id && m.token === token),
    "Missing mock push delivery",
  );
const root = `/admin/works/${workId}`;
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  await db.collection("roles").insertOne({
    id: tag,
    name: "Publicaciones QA",
    permissions: ["projects", "dashboard"],
    revision: 1,
  });
  for (const [key, _id] of Object.entries(ids)) {
    await db.collection("users").insertOne({
      _id,
      username: tag + key,
      name: key,
      role:
        key === "publisher"
          ? tag
          : key === "pending"
            ? "worker"
            : ["coordinator", "replacement"].includes(key)
              ? "operations"
              : "worker",
      status: key === "pending" ? "pending" : "active",
      emailVerified: true,
      passwordHash: admin.passwordHash,
    });
    const result = await call(
      "/auth/login",
      null,
      "POST",
      { username: tag + key, password: "Local-only-visual-test-2026!" },
      201,
    );
    sessions[key] = { cookie: result.cookie, csrf: result.data.csrf };
  }
  assert.equal(
    (await get("/account/notifications/config", "coordinator")).enabled,
    true,
    "Run local QA with VECA_PUSH_QA_MOCK=1",
  );
  await get("/account/notifications", null, 401);
  await get("/account/notifications", "pending", 403);
  await post(
    "/account/notifications/push/register",
    "pending",
    { token: "qa-pending-token-1234567890" },
    403,
  );
  const token = Object.fromEntries(
    ["coordinator", "worker", "publisher"].map((key) => [
      key,
      "qa-token-" + tag + key,
    ]),
  );
  await post(
    "/account/notifications/push/register",
    "worker",
    { token: token.worker, accountId: String(ids.coordinator) },
    403,
  );
  for (const key of Object.keys(token))
    await post("/account/notifications/push/register", key, {
      token: token[key],
    });
  const fixture = {
    ...crmLeadDefaults,
    submissionId: tag,
    name: "Cliente privado",
    workName: "Mamparas de San Luis · " + tag,
    email: "",
    phone: "999111222",
    district: "San Luis",
    requestType: "home",
    idea: "Instalación de mamparas para el hogar.",
    segment: "low",
    source: "manual",
    stage: "coordination",
    version: 1,
    contactResult: "Medidas listas",
    appointment: "2030-01-02T08:00:00-05:00",
    address: "Av. San Luis 123",
    workPlan: "Instalar mamparas y sellar juntas.",
    workHandoffRequired: true,
    workHandoff: {
      status: "accepted",
      submittedAt: new Date().toISOString(),
      submittedBy: String(ids.coordinator),
      observation: "",
    },
    workAssignment: {
      coordinatorId: String(ids.coordinator),
      coordinatorName: "coordinator",
      participantIds: [String(ids.worker)],
      participantNames: ["worker"],
    },
    events: [],
    workTasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.collection("crm_leads").insertOne({ ...fixture, _id: workId });
  let row = await post(root + "/stage-requests", "worker", {
    version: 1,
    note: "Todo preparado para iniciar la instalación en obra.",
  });
  const pending = await notice("coordinator", "Solicitud de avance");
  const message = await delivered(pending._id, token.coordinator);
  assert.equal(
    message.data.body,
    "Tienes una actualización en tu espacio de trabajo.",
  );
  assert(!JSON.stringify(message).includes("Av. San Luis"));
  assert(!JSON.stringify(message).includes("Cliente privado"));
  assert(
    message.webpush.fcmOptions.link.startsWith("http://localhost:3300/#works/"),
  );
  let page = await get("/account/notifications", "coordinator");
  assert(page.items.some((item) => item.id === pending._id));
  assert(page.unread > 0);
  assert(!("pushState" in page.items[0]));
  await get(`/account/notifications/${pending._id}`, "worker", 404);
  await post(
    `/account/notifications/${pending._id}/read`,
    "worker",
    undefined,
    404,
  );
  await post(`/account/notifications/${pending._id}/read`, "coordinator");
  assert(
    (await get("/account/notifications", "coordinator")).items.find(
      (item) => item.id === pending._id,
    ).readAt,
  );
  row = await post(
    `${root}/stage-requests/${row.stageRequest.id}/decision`,
    "coordinator",
    {
      version: row.version,
      action: "returned",
      observation: "Confirmar el acceso al primer piso.",
    },
  );
  const returned = await notice("worker", "Avance devuelto");
  await delivered(returned._id, token.worker);
  assert(
    (await get("/account/notifications", "worker")).items.some(
      (item) => item.id === returned._id,
    ),
  );
  row = await post(root + "/stage-requests", "worker", {
    version: row.version,
    note: "El acceso está confirmado y podemos iniciar la obra.",
  });
  row = await post(
    `${root}/stage-requests/${row.stageRequest.id}/decision`,
    "coordinator",
    { version: row.version, action: "approved" },
  );
  const approved = await notice("worker", "Avance aprobado");
  await delivered(approved._id, token.worker);
  row = await post(root + "/stage-requests", "worker", {
    version: row.version,
    note: "La instalación y el sellado de las juntas están terminados.",
  });
  row = await post(
    `${root}/stage-requests/${row.stageRequest.id}/decision`,
    "coordinator",
    { version: row.version, action: "approved" },
  );
  const completed = await notice("publisher", "Obra lista para publicar");
  await delivered(completed._id, token.publisher);
  const editorial = await get("/account/notifications", "publisher");
  assert(
    editorial.items.some(
      (item) => item.href === `#projects/from-work/${workId}`,
    ),
  );
  assert(!editorial.items.some((item) => item.title === "Solicitud de avance"));
  assert.equal(
    await db
      .collection("projects")
      .countDocuments({ "sourceWork.id": String(workId) }),
    0,
    "a completion notice must not publish/create a project by itself",
  );
  await db
    .collection("roles")
    .insertOne({
      id: tag + "-actions",
      name: "Acción sin módulo",
      permissions: ["works_manage", "dashboard"],
      revision: 1,
    });
  await db
    .collection("users")
    .updateOne({ _id: ids.coordinator }, { $set: { role: tag + "-actions" } });
  assert(
    !(await get("/account/notifications", "coordinator")).items.some(
      (item) => item.id === pending._id,
    ),
  );
  await db
    .collection("users")
    .updateOne({ _id: ids.coordinator }, { $set: { role: "operations" } });
  const before = await db
    .collection("notifications")
    .countDocuments({ userId: String(ids.publisher), workId: String(workId) });
  await post(root + "/notes", "coordinator", {
    version: row.version,
    text: "Seguimiento documental de la entrega final.",
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(
    await db.collection("notifications").countDocuments({
      userId: String(ids.publisher),
      workId: String(workId),
    }),
    before,
  );
  const latest = (await get(root, "coordinator")).lead;
  await call(root + "/team", "coordinator", "PUT", {
    version: latest.version,
    team: { coordinatorId: String(ids.replacement), participantIds: [] },
  });
  assert.equal(
    (await get("/account/notifications", "coordinator")).items.filter(
      (item) => item.title === "Solicitud de avance",
    ).length,
    0,
  );
  assert.equal((await get("/account/notifications", "worker")).items.length, 0);
  await post("/auth/logout", "worker");
  await db.collection("crm_leads").insertOne({
    ...fixture,
    _id: nextId,
    submissionId: tag + "next",
    stageRequest: {
      id: randomUUID(),
      from: "coordination",
      to: "execution",
      status: "returned",
      note: "Preparación de prueba para el siguiente avance.",
      requestedBy: String(ids.worker),
      requestedName: "worker",
      requestedAt: new Date().toISOString(),
      observation: "Aviso que no debe llegar después de cerrar sesión.",
    },
  });
  await post(`/admin/works/${nextId}/notes`, "coordinator", {
    version: 1,
    text: "Actualizar avisos para comprobar la sesión cerrada.",
  });
  const afterLogout = await notice("worker", "Avance devuelto", nextId);
  await waitFor(
    async () =>
      (await db.collection("notifications").findOne({ _id: afterLogout._id }))
        .pushState !== "pending",
    "Push should settle for a closed session",
  );
  assert(
    !(await pushMessages()).some(
      (m) => m.data.id === afterLogout._id && m.token === token.worker,
    ),
  );
  assert.equal(
    await db
      .collection("push_devices")
      .countDocuments({ userId: String(ids.worker) }),
    0,
  );
  await post("/account/notifications/read", "publisher");
  assert.equal((await get("/account/notifications", "publisher")).unread, 0);
  await db
    .collection("roles")
    .updateOne({ id: tag }, { $set: { permissions: ["dashboard"] } });
  assert.equal(
    (await get("/account/notifications", "publisher")).items.length,
    0,
  );
  console.log(
    "PASS notifications: targeted durable internal notices and mock FCM delivery, generic lock-screen data, role/team scoping, ownership/read counts, duplicate suppression, editorial completion handoff and logout revocation.",
  );
} finally {
  await db
    .collection("notifications")
    .deleteMany({ userId: { $in: Object.values(ids).map(String) } });
  await db
    .collection("push_devices")
    .deleteMany({ userId: { $in: Object.values(ids).map(String) } });
  await db.collection("users").deleteMany({ _id: { $in: Object.values(ids) } });
  await db
    .collection("roles")
    .deleteMany({ id: { $in: [tag, tag + "-actions"] } });
  await db
    .collection("crm_leads")
    .deleteMany({ _id: { $in: [workId, nextId] } });
  await client.close();
}
