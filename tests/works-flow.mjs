import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "@veca/content";
const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Works fixtures are local-only");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const ids = Array.from({ length: 27 }, () => new ObjectId());
const userId = new ObjectId();
const username = "works-audit-" + randomUUID();
const fileId = new ObjectId();
async function request(path, cookie = "", method = "GET", body, csrf = "") {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      Cookie: cookie,
      "X-Veca-Csrf": csrf,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  assert(admin);
  await db.collection("crm_leads").insertMany(
    ids.map((_id, index) => ({
      ...crmLeadDefaults,
      _id,
      submissionId: randomUUID(),
      version: 1,
      name: "Prueba Obras " + index,
      email: "",
      phone: "999111222",
      district: "San Luis",
      requestType: "home",
      idea: "Instalación de mamparas",
      segment: "low",
      source: "manual",
      stage: index === 26 ? "prelead" : "coordination",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    })),
  );
  await db.collection("users").insertOne({
    _id: userId,
    username,
    name: "Consulta contable QA",
    role: "accounting",
    status: "active",
    emailVerified: true,
    passwordHash: admin.passwordHash,
  });
  const session = await request("/auth/login", "", "POST", {
    username,
    password: "Local-only-visual-test-2026!",
  });
  assert.equal(session.status, 201);
  assert(session.body.user.permissions.includes("works"));
  const cookie = session.cookie;
  assert.equal((await request("/admin/works")).status, 401);
  const first = await request("/admin/works?search=Prueba%20Obras", cookie);
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 26);
  assert.equal(first.body.items.length, 24);
  const second = await request(
    "/admin/works?search=Prueba%20Obras&page=2",
    cookie,
  );
  assert.equal(second.body.items.length, 2);
  assert(
    !second.body.items.some((row) =>
      first.body.items.some((old) => old.id === row.id),
    ),
  );
  assert.equal((await request("/admin/works/" + ids[26], cookie)).status, 404);
  const detail = await request("/admin/works/" + ids[0], cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.lead.id, String(ids[0]));
  assert.deepEqual(detail.body.movements, []);
  await db.collection("crm_files").insertOne({
    _id: fileId,
    leadId: String(ids[1]),
    type: "photo",
    key: "unreachable-cross-work-file",
  });
  assert.equal(
    (await request(`/admin/works/${ids[0]}/files/${fileId}`, cookie)).status,
    404,
  );
  assert.equal(
    (await request("/admin/crm/leads/" + ids[0], cookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/admin/crm/leads/" + ids[0],
        cookie,
        "PUT",
        {},
        session.body.csrf,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/admin/works/" + ids[0],
        cookie,
        "PUT",
        {},
        session.body.csrf,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/admin/works?stage=prelead", cookie)).status,
    400,
  );
  await db
    .collection("users")
    .updateOne({ _id: userId }, { $set: { status: "suspended" } });
  assert.equal((await request("/admin/works", cookie)).status, 403);
  console.log(
    "PASS works: accounting read-only access, no commercial access, operational-stage isolation, stable pagination, validation and live suspension.",
  );
} finally {
  await db.collection("crm_files").deleteOne({ _id: fileId });
  await db.collection("crm_leads").deleteMany({ _id: { $in: ids } });
  await db.collection("sessions").deleteMany({ userId });
  await db.collection("users").deleteOne({ _id: userId });
  await client.close();
}
