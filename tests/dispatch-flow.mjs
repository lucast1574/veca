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
  const newGuidePath = `${fiscal}/works`;
  const newGuide = {
    id: new ObjectId().toHexString(),
    leadId: inserted.insertedIds[2].toHexString(),
    data: { ...ownTransport, transferAt: "", items: [] },
  };
  await request(fiscal, 401, "GET", undefined, false);
  await request(newGuidePath, 401, "GET", undefined, false);
  await request(fiscal, 401, "POST", newGuide, false);
  csrf = (
    await request("/auth/login", 201, "POST", {
      username: "admin",
      password: "Local-only-visual-test-2026!",
    })
  ).csrf;
  const dimensions = { baseMm: 1200, heightMm: 850 };
  const material = await request("/admin/crm/materials", 201, "POST", {
    sku: "DIM-GUIA-QA",
    name: "Paño de vidrio",
    unit: "unit",
    category: "Vidrio",
    location: "",
    description: "",
    minimum: 0,
    dimensions,
  });
  assert.deepEqual(material.dimensions, dimensions);
  const dimensionedLine = {
    code: material.sku,
    description: material.name,
    unitCode: "NIU",
    quantity: 3,
    materialId: material.id,
  };
  const inventoryBefore = await db
    .collection("inventory_movements")
    .countDocuments();

  const go = (path, draft) =>
    request(`${path}/${draft.id}/submit`, 201, "POST", {
      version: draft.version,
    });
  let accountingDraft;
  try {
    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    await request(fiscal, 403);
    await request(newGuidePath, 403);
    await request(fiscal, 403, "POST", newGuide);
    const first = await request(paths[0], 201, "POST", ownTransport);
    const second = await request(paths[1], 201, "POST", carrierTransport);
    const opsDraft = await request(paths[2], 201, "POST", ownTransport);
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
    const works = await request(`${newGuidePath}?search=San%20Borja`, 200);
    assert.deepEqual(
      works.map((work) => work.id),
      [newGuide.leadId],
    );
    assert.deepEqual(Object.keys(works[0]).sort(), [
      "address",
      "district",
      "id",
      "name",
    ]);
    await request(fiscal, 409, "POST", {
      ...newGuide,
      leadId: inserted.insertedIds[0].toHexString(),
    });
    const copies = await Promise.all(
      Array.from({ length: 2 }, () => request(fiscal, 201, "POST", newGuide)),
    );
    const [draft] = copies;
    assert.ok(
      copies.every((copy) => copy.id === draft.id && copy.version === 1),
    );
    assert.equal(draft.status, "draft");
    assert.equal(draft.createdInAccounting, true);
    assert.equal(
      (await request(`${fiscal}?status=draft`, 200)).items.some(
        (row) => row.id === opsDraft.id,
      ),
      false,
    );
    assert.equal(
      (await request(`${fiscal}?status=draft`, 200)).items.some(
        (row) => row.id === draft.id,
      ),
      true,
    );
    await request(`${fiscal}/${opsDraft.id}`, 404);
    await request(`${fiscal}/${opsDraft.id}`, 404, "PUT", {
      version: opsDraft.version,
      data: ownTransport,
    });
    const saved = await request(`${fiscal}/${draft.id}`, 200);
    assert.ok(saved.issues.some((issue) => issue.includes("fecha")));
    assert.ok(saved.issues.some((issue) => issue.includes("materiales")));
    await request(`${fiscal}/${draft.id}/issue`, 400, "POST", {
      version: draft.version,
    });
    const changeDraft = {
      version: draft.version,
      data: {
        ...ownTransport,
        arrivalAddress: "Obra de prueba desde Contabilidad",
        items: [
          ...ownTransport.items,
          {
            ...dimensionedLine,
            dimensions: { baseMm: 1, heightMm: 1 },
          },
        ],
      },
    };
    const completed = await request(
      `${fiscal}/${draft.id}`,
      200,
      "PUT",
      changeDraft,
    );
    assert.deepEqual(completed.issues, []);
    assert.deepEqual(completed.dispatch.items[1].dimensions, dimensions);
    assert.equal(completed.dispatch.items[1].quantity, 3);
    await request(`${fiscal}/${draft.id}`, 409, "PUT", changeDraft);
    await users.updateOne({ _id: admin._id }, { $set: { role: admin.role } });
    const editedMaterial = await request(
      `/admin/warehouse/materials/${material.id}/dimensions`,
      200,
      "PUT",
      {
        version: material.version,
        dimensions: { ...dimensions, heightMm: 900 },
      },
    );
    assert.equal(editedMaterial.unit, "unit");
    assert.equal(editedMaterial.balance, material.balance);
    await request(
      `/admin/warehouse/materials/${material.id}/dimensions`,
      409,
      "PUT",
      { version: material.version, dimensions },
    );
    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    const resaved = await request(`${fiscal}/${draft.id}`, 200, "PUT", {
      ...changeDraft,
      version: completed.dispatch.version,
    });
    assert.deepEqual(resaved.dispatch.items[1].dimensions, dimensions);
    const tooLong = await request(`${fiscal}/${draft.id}`, 200, "PUT", {
      version: resaved.dispatch.version,
      data: {
        ...changeDraft.data,
        items: [
          ownTransport.items[0],
          { ...dimensionedLine, description: "A".repeat(250) },
        ],
      },
    });
    assert.match(tooLong.issues.join(" "), /descripciones.*medidas/);
    await request(`${fiscal}/${draft.id}/issue`, 400, "POST", {
      version: tooLong.dispatch.version,
    });
    const corrected = await request(`${fiscal}/${draft.id}`, 200, "PUT", {
      ...changeDraft,
      version: tooLong.dispatch.version,
    });
    accountingDraft = corrected.dispatch;
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
    assert.equal(
      (await request(paths[2], 200)).some(
        (row) => row.id === accountingDraft.id,
      ),
      false,
    );
    await request(`${paths[2]}/${accountingDraft.id}`, 404, "PUT", {
      version: accountingDraft.version,
      data: ownTransport,
    });
    await request(`${paths[2]}/${accountingDraft.id}/submit`, 404, "POST", {
      version: accountingDraft.version,
    });
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
  if (process.env.VECA_GUIDE_QA_ISSUER_DISABLED === "1") {
    const path = `${fiscal}/${accountingDraft.id}`;
    await request(`${path}/issue`, 503, "POST", {
      version: accountingDraft.version,
    });
    const { dispatch } = await request(path, 200);
    assert.equal(dispatch.status, "draft");
    assert.equal(dispatch.version, accountingDraft.version);
  } else if (process.env.VECA_GUIDE_QA_MOCK === "1") {
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
    const path = `${fiscal}/${accountingDraft.id}`;
    const sent = await request(`${path}/issue`, 201, "POST", {
      version: accountingDraft.version,
    });
    assert.equal(sent.status, "pending");
    const confirmed = await request(`${path}/check`, 201, "POST", {
      version: sent.version,
    });
    assert.equal(confirmed.status, "accepted");
    assert.match(await request(`${path}/pdf`, 200), /^%PDF/);
    assert.ok(
      (await request(paths[2], 200)).some(
        (row) => row.id === accountingDraft.id,
      ),
    );
  }
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    inventoryBefore,
  );
  console.log(
    "Guías: permisos, borradores contables, revisión, emisión simulada y saldo de inventario verificados.",
  );
} finally {
  await mongo.close();
}
