import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { DEMO_CASES } from "../packages/content/dist/index.js";

const root = "/admin/administration/demo";
let cookie, csrf;
async function request(path, method = "GET", data, status = 200) {
  const response = await fetch("http://localhost:4400" + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(cookie ? { Cookie: cookie, "X-Veca-Csrf": csrf } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (response.headers.get("content-type") === "application/pdf") {
    assert.equal(response.status, status);
    return response.text();
  }
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  if (path === "/auth/login") {
    cookie = response.headers.get("set-cookie").split(";")[0];
    csrf = body.csrf;
  }
  return body;
}
await request(root, "GET", undefined, 401);
await request(
  "/auth/login",
  "POST",
  {
    username: "admin",
    password: "Local-only-visual-test-2026!",
  },
  201,
);

const mongo = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
await mongo.connect();
try {
  const db = mongo.db("veca_qa");
  const users = db.collection("users");
  const admin = await users.findOne({ username: "admin" });
  try {
    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    await request(root + "/prepare", "POST", {}, 403);
    await request(root + "/invoices", "POST", {}, 403);
  } finally {
    await users.updateOne({ _id: admin._id }, { $set: { role: admin.role } });
  }

  const initial = await request(root);
  assert.deepEqual(
    initial,
    [],
    "Ejecuta esta prueba en la base local recién inicializada.",
  );
  for (const demo of DEMO_CASES) {
    await request(
      "/admin/crm/leads",
      "POST",
      {
        name: demo.name,
        email: demo.key + "@example.invalid",
        phone: "000000001",
        idea: "Descripción inicial del caso de demostración.",
        district: demo.district,
        requestType: "premium",
        submissionId: randomUUID(),
        website: "",
      },
      201,
    );
  }
  const movementBefore = await db
    .collection("inventory_movements")
    .countDocuments();
  const mailBefore = await db.collection("mail_deliveries").countDocuments();
  const prepared = await request(root + "/prepare", "POST", {}, 201);
  assert.equal(prepared.length, 2);
  assert.deepEqual(await request(root + "/prepare", "POST", {}, 201), prepared);
  for (const demo of prepared) {
    const { lead } = await request("/admin/crm/leads/" + demo.leadId);
    assert.equal(
      lead.stage,
      demo.key === "mamparas" ? "execution" : "coordination",
    );
    const guidePath = "/admin/accounting/guides/" + demo.dispatchId;
    const { dispatch, issues } = await request(guidePath);
    assert.equal(dispatch.demo, true);
    assert.equal(
      dispatch.status,
      demo.key === "mamparas" ? "review" : "returned",
    );
    assert.equal(issues.length, demo.key === "mamparas" ? 0 : 1);
    await request(
      guidePath + "/issue",
      "POST",
      { version: dispatch.version },
      409,
    );
  }

  assert.deepEqual(await request(root + "/invoices"), []);
  if (process.env.VECA_GUIDE_QA_MOCK === "1") {
    const invoices = await request(root + "/invoices", "POST", {}, 201);
    assert.equal(invoices.length, 2);
    assert.match(await request(root + "/invoices/mamparas/pdf"), /^%PDF/);
    assert.ok(invoices.every((invoice) => invoice.status === "accepted"));
    const sort = (rows) => rows.sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(
      sort(await request(root + "/invoices", "POST", {}, 201)),
      sort(invoices),
    );
  }
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    movementBefore,
  );
  assert.equal(
    await db.collection("mail_deliveries").countDocuments(),
    mailBefore,
  );
  console.log(
    "Demostración: permisos, dos obras y despachos de ejemplo, facturas beta idempotentes y sin correo ni movimientos.",
  );
} finally {
  await mongo.close();
}
