import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "../packages/content/dist/index.js";

const base = "http://localhost:4400";
const crm = "/admin/crm/leads";
const fiscal = "/admin/accounting/guides";
const mongo = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
let cookie = "";
let csrf = "";

async function request(path, expected, method = "GET", body, auth = true) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(auth ? { Cookie: cookie, "X-Veca-Csrf": csrf } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.get("content-type") === "application/pdf") {
    assert.equal(response.status, expected);
    return response.text();
  }
  const result = await response.json();
  assert.ok(
    [expected].flat().includes(response.status),
    JSON.stringify(result),
  );
  if (path === "/auth/login")
    cookie = response.headers.get("set-cookie").split(";")[0];
  return result;
}

const tomorrow = new Date(Date.now() + 86_400_000);
const transferDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Lima",
}).format(tomorrow);
const ownTransport = {
  startAddress: "Almacén de prueba",
  startUbigeo: "150134",
  arrivalAddress: "Obra de San Borja de prueba",
  arrivalUbigeo: "150130",
  transferAt: transferDate + "T08:00",
  motiveCode: "13",
  motiveDescription: "Traslado para instalación",
  recipientType: "6",
  recipientNumber: "20000000001",
  recipientName: "Cliente de prueba",
  transportMode: "02",
  carrierRuc: "",
  carrierName: "",
  vehiclePlate: "ABC123",
  driverDocument: "00000001",
  driverName: "Conductor",
  driverLastName: "De prueba",
  driverLicense: "A00000001",
  weightKg: 420,
  items: [
    {
      code: "VID-010",
      description: "Vidrio templado",
      unitCode: "MTK",
      quantity: 18,
    },
  ],
};
const carrierTransport = {
  ...ownTransport,
  transferAt: transferDate + "T11:00",
  arrivalAddress: "Obra de Surco de prueba",
  arrivalUbigeo: "150140",
  transportMode: "01",
  carrierName: "Transportista de prueba",
  items: [
    {
      code: "AGL-018",
      description: "Tablero aglomerado",
      unitCode: "NIU",
      quantity: 5,
    },
  ],
};

await mongo.connect();
try {
  const db = mongo.db("veca_qa");
  const users = db.collection("users");
  const admin = await users.findOne({ username: "admin" });
  assert.ok(admin, "Ejecuta scripts/local-qa.mjs antes de esta prueba.");
  const store = db.collection("crm_leads");
  const cases = [
    ["[DEMO] Mamparas San Borja", "sanborja@example.invalid"],
    ["[DEMO] Fachada y panelería Surco", "surco@example.invalid"],
    ["Mamparas San Borja · Proveedor simulado", "proveedor@qa.test"],
  ];
  const now = new Date().toISOString();
  const inserted = await store.insertMany(
    cases.map(([name, email]) => ({
      _id: new ObjectId(),
      ...crmLeadDefaults,
      name,
      email,
      phone: "000000001",
      district: "Lima",
      requestType: "premium",
      idea: "Caso de demostración fiscal.",
      segment: "high",
      source: "manual",
      stage: "execution",
      submissionId: randomUUID(),
      createdAt: now,
      updatedAt: now,
      contactedAt: now,
      completedAt: null,
      version: 1,
      events: [],
    })),
  );
  const paths = Object.values(inserted.insertedIds).map(
    (id) => `${crm}/${id}/dispatches`,
  );
  await request(fiscal, 401, "GET", undefined, false);
  csrf = (
    await request("/auth/login", 201, "POST", {
      username: "admin",
      password: "Local-only-visual-test-2026!",
    })
  ).csrf;
  const inventoryBefore = await db
    .collection("inventory_movements")
    .countDocuments();

  const go = (path, draft) =>
    request(`${path}/${draft.id}/submit`, 201, "POST", {
      version: draft.version,
    });
  try {
    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    await request(fiscal, 403);
    const first = await request(paths[0], 201, "POST", ownTransport);
    const second = await request(paths[1], 201, "POST", carrierTransport);
    assert.equal(first.status, "draft");
    const alternateId = paths[0].replace(
      String(inserted.insertedIds[0]),
      String(inserted.insertedIds[0]).toUpperCase(),
    );
    assert.ok(
      (await request(alternateId, 200)).some((row) => row.id === first.id),
    );
    await go(paths[0], first);
    await go(paths[1], second);

    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    await request(paths[0], 403);
    const { items: queue } = await request(fiscal, 200);
    assert.ok(
      queue.findIndex((row) => row.id === first.id) <
        queue.findIndex((row) => row.id === second.id),
    );
    const ready = await request(`${fiscal}/${first.id}`, 200);
    assert.deepEqual(ready.issues, []);
    await request(`${fiscal}/${first.id}/issue`, 409, "POST", {
      version: ready.dispatch.version,
    });
    const incomplete = await request(`${fiscal}/${second.id}`, 200);
    assert.deepEqual(incomplete.issues, ["Completa el RUC del transportista."]);
    const returned = await request(
      `${fiscal}/${second.id}/return`,
      201,
      "POST",
      {
        version: incomplete.dispatch.version,
        observation: "Falta el RUC del transportista.",
      },
    );
    assert.equal(returned.status, "returned");

    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    const edited = await request(`${paths[1]}/${second.id}`, 200, "PUT", {
      version: returned.version,
      data: { ...carrierTransport, carrierRuc: "20000000002" },
    });
    assert.equal((await go(paths[1], edited)).status, "review");
  } finally {
    await users.updateOne({ _id: admin._id }, { $set: { role: admin.role } });
  }

  // This extra copy omits the demo marker only inside local QA, where outbound fiscal
  // requests are intercepted by the private harness and never reach SUNAT.
  if (process.env.VECA_GUIDE_QA_MOCK === "1") {
    const created = await request(paths[2], 201, "POST", ownTransport);
    const reviewed = await go(paths[2], created);
    const outcomes = await Promise.all(
      [0, 1].map(() =>
        request(`${fiscal}/${created.id}/issue`, [201, 409], "POST", {
          version: reviewed.version,
        }),
      ),
    );
    const pending = outcomes.find((result) => result.status === "pending");
    assert.ok(pending, JSON.stringify(outcomes));
    assert.equal(
      outcomes.filter((result) => result.statusCode === 409).length,
      1,
    );
    const accepted = await request(
      `${fiscal}/${created.id}/check`,
      201,
      "POST",
      { version: pending.version },
    );
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.guideNumber, "T001-17");
    assert.match(await request(`${fiscal}/${created.id}/pdf`, 200), /^%PDF/);
    await request(`${paths[0]}/${created.id}/pdf`, 404);
  }
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    inventoryBefore,
  );
  console.log(
    "Guías: roles, dos demos, observación, corrección y saldo de inventario verificados.",
  );
} finally {
  await mongo.close();
}
