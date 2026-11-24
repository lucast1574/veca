import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults, leadUpdateSchema } from "@veca/content";

const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local-only work fixtures");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const tag = "stage-" + randomUUID();
const ids = Object.fromEntries(
  [
    "coordinator",
    "other",
    "worker",
    "outsider",
    "commercial",
    "accounting",
  ].map((key) => [key, new ObjectId()]),
);
const workId = new ObjectId(),
  preparingId = new ObjectId();
const root = `/admin/works/${workId}`;
const sessions = {};
async function call(path, who, method = "GET", body, expected = 200) {
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
    expected,
    `${who} ${method} ${path}: ${JSON.stringify(data)}`,
  );
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const get = async (path, who = "coordinator", status = 200) =>
  (await call(path, who, "GET", undefined, status)).data;
const post = async (path, who, body, status = 201) =>
  (await call(path, who, "POST", body, status)).data;
const put = async (path, who, body, status = 200) =>
  (await call(path, who, "PUT", body, status)).data;
const input = (row, stage) => ({
  ...Object.fromEntries(
    Object.keys(leadUpdateSchema.shape).map((key) => [key, row[key]]),
  ),
  stage,
});
const requestPath = root + "/stage-requests";
const decisionPath = (row) => `${requestPath}/${row.stageRequest.id}/decision`;
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  for (const [key, _id] of Object.entries(ids)) {
    await db.collection("users").insertOne({
      _id,
      username: tag + key,
      name: key,
      role: ["coordinator", "other"].includes(key)
        ? "operations"
        : key === "outsider"
          ? "worker"
          : key,
      status: "active",
      emailVerified: true,
      passwordHash: admin.passwordHash,
    });
    const login = await call(
      "/auth/login",
      null,
      "POST",
      { username: tag + key, password: "Local-only-visual-test-2026!" },
      201,
    );
    sessions[key] = { cookie: login.cookie, csrf: login.data.csrf };
  }
  const fixture = {
    ...crmLeadDefaults,
    submissionId: tag,
    name: tag,
    email: "",
    phone: "999111222",
    district: "San Luis",
    requestType: "home",
    idea: "Instalación de ventanas y mamparas.",
    segment: "low",
    source: "manual",
    stage: "coordination",
    version: 1,
    contactResult: "Medidas confirmadas",
    appointment: "2030-01-01T08:00:00-05:00",
    address: "Av. San Luis 123",
    workPlan: "Instalar mamparas y sellar juntas.",
    workHandoffRequired: true,
    workHandoff: {
      status: "accepted",
      submittedBy: String(ids.commercial),
      submittedAt: new Date().toISOString(),
      observation: "",
    },
    workAssignment: {
      coordinatorId: String(ids.coordinator),
      coordinatorName: "coordinator",
      participantIds: [String(ids.worker)],
      participantNames: ["worker"],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    workTasks: [],
  };
  await db.collection("crm_leads").insertMany([
    { ...fixture, _id: workId },
    {
      ...fixture,
      _id: preparingId,
      submissionId: tag + "preparing",
      workHandoff: { ...fixture.workHandoff, status: "submitted" },
    },
  ]);
  const body = {
    version: 1,
    note: "Medidas y materiales listos para iniciar la instalación.",
  };
  await post(requestPath, "commercial", body, 403);
  await post(requestPath, "accounting", body, 403);
  await post(requestPath, "outsider", body, 404);
  await post(requestPath, "other", body, 403);
  await post(
    `/admin/works/${preparingId}/stage-requests`,
    "coordinator",
    body,
    409,
  );
  await post(requestPath, "worker", { ...body, to: "completed" }, 400);
  let row = await post(requestPath, "worker", body);
  assert.equal(row.stage, "coordination");
  assert.equal(row.stageRequest.to, "execution");
  assert.equal(row.stageRequest.requestedBy, String(ids.worker));
  assert(
    row.events.some((e) => e.kind === "review" && e.text.includes(body.note)),
  );
  await post(requestPath, "worker", { ...body, version: row.version }, 409);
  let inbox = await get("/admin/dashboard/inbox");
  assert(
    inbox
      .find((s) => s.key === "stage_requests")
      .items.some((item) => item.id === String(workId)),
  );
  assert.equal(
    (await get("/admin/dashboard/inbox", "other")).find(
      (s) => s.key === "stage_requests",
    ).count,
    0,
  );
  await post(
    decisionPath(row),
    "worker",
    { version: row.version, action: "approved" },
    403,
  );
  await post(
    decisionPath(row),
    "other",
    { version: row.version, action: "approved" },
    403,
  );
  await put(root, "other", input(row, "execution"), 403);
  await put(root, "coordinator", input(row, "execution"), 409);
  await put(
    `/admin/crm/leads/${workId}`,
    "coordinator",
    input(row, "execution"),
    409,
  );
  await post(
    decisionPath(row),
    "coordinator",
    { version: row.version, action: "returned", observation: "" },
    400,
  );
  row = await post(decisionPath(row), "coordinator", {
    version: row.version,
    action: "returned",
    observation: "Confirmar el acceso a la obra.",
  });
  assert.equal(row.stage, "coordination");
  assert.equal(row.stageRequest.status, "returned");
  assert.equal(
    (await get("/admin/dashboard/inbox", "worker")).find(
      (s) => s.key === "stage_returns",
    ).count,
    1,
  );
  await db
    .collection("roles")
    .insertOne({
      id: tag,
      name: "Coordinación sin Obras",
      permissions: ["leads", "works_manage", "dashboard"],
      revision: 1,
    });
  await db
    .collection("users")
    .updateOne({ _id: ids.coordinator }, { $set: { role: tag } });
  await put(
    `/admin/crm/leads/${workId}`,
    "coordinator",
    input(row, "execution"),
    403,
  );
  await db
    .collection("users")
    .updateOne({ _id: ids.coordinator }, { $set: { role: "operations" } });
  const previousRequest = row.stageRequest.id;
  row = await post(requestPath, "worker", {
    version: row.version,
    note: "El acceso quedó confirmado y podemos iniciar la obra.",
  });
  assert.notEqual(row.stageRequest.id, previousRequest);
  await post(
    `${requestPath}/${previousRequest}/decision`,
    "coordinator",
    { version: row.version, action: "approved" },
    409,
  );
  await post(
    decisionPath(row),
    "coordinator",
    { version: row.version - 1, action: "approved" },
    409,
  );
  const firstDecision = decisionPath(row),
    oldVersion = row.version;
  row = await post(firstDecision, "coordinator", {
    version: oldVersion,
    action: "approved",
    observation: "Acceso revisado. Iniciar instalación.",
  });
  assert.equal(row.stage, "execution");
  assert.equal(row.stageRequest.status, "approved");
  assert.equal(
    (await get(`/admin/crm/leads/${workId}`, "commercial")).lead.stage,
    "execution",
  );
  await post(
    firstDecision,
    "coordinator",
    { version: oldVersion, action: "approved" },
    409,
  );
  assert.equal(
    (await get("/admin/dashboard/inbox")).find(
      (s) => s.key === "stage_requests",
    ).count,
    0,
  );
  assert(
    row.events.some(
      (e) =>
        e.kind === "stage" &&
        e.from === "coordination" &&
        e.to === "execution" &&
        e.text.includes("Avance aprobado"),
    ),
  );
  const taskId = randomUUID();
  row = await post(root + "/tasks", "coordinator", {
    id: taskId,
    version: row.version,
    title: "Sellar las juntas",
    assignedTo: String(ids.worker),
    dueDate: "2030-01-02",
  });
  await post(
    requestPath,
    "worker",
    {
      version: row.version,
      note: "Instalación terminada para revisar y cerrar.",
    },
    409,
  );
  row = await put(root + "/tasks/" + taskId, "worker", {
    version: row.version,
    status: "done",
  });
  row = await post(requestPath, "worker", {
    version: row.version,
    note: "Las mamparas están instaladas y todas las juntas selladas.",
  });
  assert.equal(row.stageRequest.to, "completed");
  const equipmentId = new ObjectId();
  await db.collection("warehouse_equipment").insertOne({
    _id: equipmentId,
    qaTag: tag,
    assignment: { workId: String(workId) },
  });
  await post(
    decisionPath(row),
    "coordinator",
    { version: row.version, action: "approved" },
    409,
  );
  assert.equal((await get(root)).lead.stageRequest.status, "pending");
  await db.collection("warehouse_equipment").deleteOne({ _id: equipmentId });
  row = await put(root + "/tasks/" + taskId, "worker", {
    version: row.version,
    status: "in_progress",
  });
  await post(
    decisionPath(row),
    "coordinator",
    { version: row.version, action: "approved" },
    409,
  );
  row = await put(root + "/tasks/" + taskId, "worker", {
    version: row.version,
    status: "done",
  });
  row = await put(root + "/team", "coordinator", {
    version: row.version,
    team: {
      coordinatorId: String(ids.other),
      participantIds: [String(ids.worker)],
    },
  });
  await post(
    decisionPath(row),
    "coordinator",
    { version: row.version, action: "approved" },
    403,
  );
  assert.equal(
    (await get("/admin/dashboard/inbox", "other")).find(
      (s) => s.key === "stage_requests",
    ).count,
    1,
  );
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      post(decisionPath(row), "other", {
        version: row.version,
        action: "approved",
        observation:
          "Obra revisada, instalación completa y materiales conciliados.",
      }),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  row = (await get(root, "other")).lead;
  assert.equal(row.stage, "completed");
  assert(row.completedAt);
  assert.equal(row.stageRequest.decidedBy, String(ids.other));
  assert.equal(row.completionReview, null);
  assert.equal(
    (await get(`/admin/crm/leads/${workId}`, "commercial")).lead.stage,
    "completed",
  );
  assert.equal(
    row.events.filter((e) => e.kind === "stage" && e.to === "completed").length,
    1,
  );
  await post(
    requestPath,
    "worker",
    {
      version: row.version,
      note: "Intento de solicitud después del cierre de la obra.",
    },
    409,
  );
  console.log(
    "PASS work stage flow: scoped request, coordinator approval/return, inboxes, immutable target, stale/duplicate decisions, CRM sync, reassignment, guarded closeout and concurrent approval.",
  );
} finally {
  await db.collection("users").deleteMany({ _id: { $in: Object.values(ids) } });
  await db
    .collection("crm_leads")
    .deleteMany({ _id: { $in: [workId, preparingId] } });
  await db.collection("warehouse_equipment").deleteMany({ qaTag: tag });
  await db.collection("roles").deleteOne({ id: tag });
  await client.close();
}
