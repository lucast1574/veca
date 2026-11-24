import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import sharp from "sharp";
import { crmLeadDefaults } from "@veca/content";
const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local-only work fixtures");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const people = Object.fromEntries(
  [
    "commercial",
    "coordinator",
    "other",
    "worker",
    "replacement",
    "accounting",
  ].map((key) => [key, new ObjectId()]),
);
const workId = new ObjectId();
const otherWork = new ObjectId();
const fixture = "work-team-" + randomUUID();
async function call(path, session, method = "GET", body) {
  const form = body instanceof FormData;
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(session
        ? { Cookie: session.cookie, "X-Veca-Csrf": session.csrf }
        : {}),
      ...(!form && body ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
function expect(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}
function input(lead, stage) {
  const {
    id,
    source,
    createdAt,
    updatedAt,
    contactedAt,
    completedAt,
    events,
    workAssignment,
    workHandoff,
    ...data
  } = lead;
  return { ...data, stage };
}
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  const sessions = {};
  for (const [key, id] of Object.entries(people)) {
    const role = ["coordinator", "other"].includes(key)
      ? "operations"
      : key === "replacement"
        ? "worker"
        : key;
    await db.collection("users").insertOne({
      _id: id,
      username: fixture + key,
      name: key,
      role,
      status: "active",
      emailVerified: true,
      passwordHash: admin.passwordHash,
    });
    const result = await call("/auth/login", null, "POST", {
      username: fixture + key,
      password: "Local-only-visual-test-2026!",
    });
    const data = expect(result, 201);
    sessions[key] = { cookie: result.cookie, csrf: data.csrf };
  }
  const { migrateAccess } =
    await import("../apps/api/dist/database/access-migration.js");
  await db.collection("schema_migrations").deleteOne({ name: "work-teams-v1" });
  await migrateAccess(db);
  await migrateAccess(db);
  const workerRole = await db.collection("roles").findOne({ id: "worker" });
  assert.deepEqual(workerRole.permissions, ["works", "works_report"]);
  await db.collection("crm_leads").insertMany(
    [workId, otherWork].map((_id) => ({
      ...crmLeadDefaults,
      _id,
      submissionId: randomUUID(),
      name: fixture,
      version: 1,
      email: "",
      phone: "999111222",
      requestType: "home",
      district: "San Luis",
      idea: "Instalar mamparas y ventanas.",
      stage: "coordination",
      workHandoffRequired: true,
      segment: "low",
      appointment: "2030-01-02T08:00:00-05:00",
      contactResult: "Medidas confirmadas.",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    })),
  );
  const root = "/admin/works/" + workId;
  expect(await call(root, sessions.coordinator), 404);
  const handoff = "/admin/crm/leads/" + workId + "/handoff";
  const team = {
    coordinatorId: String(people.coordinator),
    participantIds: [String(people.worker)],
  };
  const draft = {
    ...team,
    version: 1,
    address: "Av. San Luis 123",
    workPlan: "Instalar dos mamparas y sellar juntas.",
  };
  expect(await call(handoff, sessions.worker, "POST", draft), 403);
  expect(
    await call(handoff, sessions.commercial, "POST", {
      ...draft,
      coordinatorId: String(people.worker),
    }),
    400,
  );
  let work = expect(
    await call(handoff, sessions.commercial, "POST", draft),
    201,
  );
  assert.equal(work.workHandoff.status, "submitted");
  expect(
    await call(handoff, sessions.commercial, "POST", {
      ...draft,
      version: work.version,
    }),
    409,
  );
  expect(await call(root, sessions.worker), 404);
  expect(
    await call(root + "/notes", sessions.worker, "POST", {
      version: work.version,
      text: "No debe entrar",
    }),
    404,
  );
  expect(
    await call(root, sessions.coordinator, "PUT", input(work, "execution")),
    409,
  );
  expect(
    await call(root + "/handoff", sessions.other, "POST", {
      version: work.version,
      action: "accepted",
    }),
    403,
  );
  work = expect(
    await call(root + "/handoff", sessions.coordinator, "POST", {
      version: work.version,
      action: "returned",
      observation: "Completar el alcance de acabados.",
    }),
    201,
  );
  assert.equal(work.workHandoff.status, "returned");
  work = expect(
    await call(handoff, sessions.commercial, "POST", {
      ...draft,
      version: work.version,
    }),
    201,
  );
  work = expect(
    await call(root + "/handoff", sessions.coordinator, "POST", {
      version: work.version,
      action: "accepted",
    }),
    201,
  );
  expect(
    await call(
      "/admin/crm/leads/" + workId,
      sessions.commercial,
      "PUT",
      input(work, "coordination"),
    ),
    403,
  );
  assert.equal(
    expect(await call(root, sessions.worker), 200).lead.id,
    String(workId),
  );
  const listed = expect(
    await call("/admin/works?search=" + fixture, sessions.worker),
    200,
  );
  assert.deepEqual(
    listed.items.map((row) => row.id),
    [String(workId)],
  );
  expect(await call("/admin/works/" + otherWork, sessions.worker), 404);
  expect(await call("/admin/crm/leads/" + workId, sessions.worker), 403);
  expect(
    await call(root + "/team", sessions.worker, "PUT", {
      version: work.version,
      team,
    }),
    403,
  );
  expect(
    await call(root + "/notes", sessions.accounting, "POST", {
      version: work.version,
      text: "No autorizado",
    }),
    403,
  );
  work = expect(
    await call(root, sessions.coordinator, "PUT", input(work, "execution")),
    200,
  );
  const previous = work.version;
  work = expect(
    await call(root + "/notes", sessions.worker, "POST", {
      version: previous,
      text: "Mampara instalada.",
    }),
    201,
  );
  expect(
    await call(root + "/notes", sessions.worker, "POST", {
      version: previous,
      text: "Versión anterior",
    }),
    409,
  );
  const image = await sharp("assets/mamparas.webp")
    .resize(40)
    .webp()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([image], { type: "image/webp" }), "avance.webp");
  form.append("sharing", "clients");
  const photo = expect(
    await call(root + "/files", sessions.worker, "POST", form),
    201,
  );
  assert.equal(photo.sharing, "internal");
  const contractForm = new FormData();
  contractForm.append(
    "file",
    new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
    "contrato.pdf",
  );
  const contract = expect(
    await call(root + "/files", sessions.coordinator, "POST", contractForm),
    201,
  );
  expect(await call(contract.url, sessions.worker), 404);
  expect(await call(contract.url, sessions.accounting), 200);
  const files = expect(await call(root, sessions.worker), 200).attachments;
  assert.equal(files.length, 1);
  expect(await call(files[0].url, sessions.worker), 200);
  work = expect(
    await call(root + "/team", sessions.coordinator, "PUT", {
      version: work.version,
      team: { ...team, participantIds: [String(people.replacement)] },
    }),
    200,
  );
  expect(await call(root, sessions.worker), 404);
  expect(await call(files[0].url, sessions.worker), 404);
  expect(
    await call(root + "/notes", sessions.worker, "POST", {
      version: work.version,
      text: "Acceso revocado",
    }),
    404,
  );
  expect(await call(root, sessions.replacement), 200);
  await db
    .collection("users")
    .updateOne({ _id: people.replacement }, { $set: { status: "suspended" } });
  expect(await call(root, sessions.replacement), 403);
  console.log(
    "PASS work teams: handoff, return/resend, coordinator acceptance, blocked early start, scoped lists/files, worker reports/photos, read-only accounting, stale edits, reassignment and suspension.",
  );
} finally {
  await db
    .collection("crm_files")
    .deleteMany({ leadId: { $in: [String(workId), String(otherWork)] } });
  await db
    .collection("crm_leads")
    .deleteMany({ _id: { $in: [workId, otherWork] } });
  await db
    .collection("sessions")
    .deleteMany({ userId: { $in: Object.values(people) } });
  await db
    .collection("users")
    .deleteMany({ _id: { $in: Object.values(people) } });
  await client.close();
}
