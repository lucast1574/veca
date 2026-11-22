import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import {
  removeVecaDemo,
  vecaDemoReport,
} from "../apps/api/dist/database/remove-veca-demo.js";

const api = "http://localhost:4400";
const dbClient = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
const endpoint = api + "/admin/administration/fiscal";
await dbClient.connect();
const db = dbClient.db("veca_launch_qa");

try {
  const live = new ObjectId();
  const blocked = new ObjectId();
  const fake = new ObjectId("6b03375985ff0b8ccf118117");
  const lookalike = new ObjectId();
  await db.collection("crm_leads").insertMany([
    {
      _id: fake,
      name: "[DEMO] Mamparas San Borja",
      email: "lead@example.invalid",
      source: "manual",
    },
    {
      _id: blocked,
      name: "[DEMO] Vinculado",
      email: "another@example.invalid",
      source: "manual",
    },
    {
      _id: lookalike,
      name: "[DEMO] Etiqueta sin correo de prueba",
      email: "test@example.com",
      source: "manual",
    },
    {
      _id: live,
      name: "Cliente real",
      email: "live@example.com",
      source: "manual",
    },
  ]);
  await db.collection("dispatches").insertMany([
    {
      _id: new ObjectId("de0000000000000000000001"),
      demo: true,
      leadId: String(fake),
      status: "review",
      guideNumber: "",
    },
    {
      _id: new ObjectId("de0000000000000000000002"),
      demo: true,
      leadId: "6b03376d85ff0b8ccf118118",
      status: "returned",
    },
    {
      demo: true,
      leadId: String(blocked),
      status: "accepted",
      externalId: "fiscal-record",
    },
    { demo: false, leadId: String(live), status: "review" },
  ]);
  await db
    .collection("crm_files")
    .insertOne({ leadId: String(fake), name: "ficticio.pdf" });
  await db.collection("warehouse_plans").insertOne({ _id: fake, revision: 1 });
  await db
    .collection("demo_invoices")
    .insertOne({ _id: "mamparas", id: "beta-id" });

  assert.deepEqual(await removeVecaDemo(db), {
    leads: 1,
    dispatches: 2,
    files: 1,
    invoices: 1,
    plans: 1,
    blocked: 1,
  });
  assert.deepEqual(await removeVecaDemo(db), {
    leads: 0,
    dispatches: 0,
    files: 0,
    invoices: 0,
    plans: 0,
    blocked: 1,
  });
  const report = await vecaDemoReport(db);
  assert.deepEqual(report.deleted, {
    leads: 1,
    dispatches: 2,
    files: 1,
    invoices: 1,
    blocked: 1,
  });
  assert.deepEqual(report.remaining, { leads: 1, dispatches: 1, invoices: 0 });
  assert.equal(
    await db
      .collection("crm_leads")
      .countDocuments({ _id: { $in: [live, lookalike, blocked] } }),
    3,
  );
  assert.equal(
    await db.collection("dispatches").countDocuments({ demo: false }),
    1,
  );

  const rejected = await fetch(endpoint);
  assert.equal(rejected.status, 401);
  const login = await fetch(api + "/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3300",
    },
    body: JSON.stringify({
      username: "admin",
      password: "Local-only-visual-test-2026!",
    }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(endpoint, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const readiness = await response.json();
  if (process.env.VECA_GUIDE_QA_MOCK === "1") {
    assert.equal(readiness.status, "ready");
    assert.deepEqual(readiness.invoiceSeries, ["F001"]);
    assert.deepEqual(readiness.guideSeries, ["T001"]);
  } else {
    assert.equal(readiness.status, "missingKey");
  }
  console.log(
    "Limpieza selectiva e idempotente, protección de registros reales y comprobación fiscal sin emisión.",
  );
} finally {
  await db.dropDatabase();
  await dbClient.close();
}
