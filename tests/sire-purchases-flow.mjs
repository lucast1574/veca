import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
const base = process.env.QA_API_URL || "http://localhost:4400";
assert.equal(new URL(base).hostname, "localhost");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
}).format(new Date());
const root = "/admin/accounting";
let cookie, csrf;
const ids = [];
const orderId = new ObjectId();
try {
  const login = await fetch(base + "/auth/login", {
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
  csrf = (await login.json()).csrf;
  cookie = login.headers.get("set-cookie").split(";")[0];
  async function request(path, method = "GET", body, options = {}) {
    const response = await fetch(base + root + path, {
      method,
      headers: {
        Origin: "http://localhost:3300",
        ...(options.auth === false ? {} : { Cookie: cookie }),
        ...(options.csrf === false ? {} : { "X-Veca-Csrf": csrf }),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && {
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    });
    return { status: response.status, data: await response.json() };
  }
  const syncPath = `/period/${month}/reconcile/purchases/automatic`;
  const started = await request(syncPath, "POST");
  assert.equal(started.status, 201);
  let result = started;
  for (let n = 0; n < 5 && result.data.status !== "ready"; n++)
    result = await request(syncPath + "/" + started.data.job);
  assert.equal(result.data.status, "ready");
  const inbox = async () =>
    (await request(`/sire/purchases?month=${month}&state=all`)).data;
  let list = await inbox();
  assert.equal(list.total, 2);
  assert.equal(list.pending, 2);
  const first = list.items.find((row) => row.reference === "FQA-1");
  const second = list.items.find((row) => row.reference === "FQA-2");
  ids.push(first.id, second.id);
  assert.equal(first.supplier, "Proveedor QA local");
  assert.equal(first.net, 10000);
  assert.equal(first.tax, 1800);
  assert.equal("job" in list, false);
  assert.equal("issuerRuc" in first, false);
  const body = {
    version: first.version,
    description: "Transporte QA",
    destination: "general",
    kind: "transport",
  };
  const importPath = `/sire/purchases/${first.id}/incorporate`;
  assert.equal(
    (await request(importPath, "POST", body, { auth: false })).status,
    401,
  );
  assert.equal(
    (await request(importPath, "POST", body, { csrf: false })).status,
    403,
  );
  assert.equal(
    (await request(importPath, "POST", { ...body, netCents: 1 })).status,
    400,
  );
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => request(importPath, "POST", body)),
  );
  assert.ok(
    concurrent.every((row) => row.status === 201),
    JSON.stringify(concurrent),
  );
  const costId = concurrent[0].data.costId;
  assert.ok(concurrent.every((row) => row.data.costId === costId));
  assert.equal(
    await db
      .collection("accounting_costs")
      .countDocuments({ reference: "FQA-1", supplierRuc: "20100066603" }),
    1,
  );
  const cost = await db
    .collection("accounting_costs")
    .findOne({ _id: new ObjectId(costId) });
  assert.equal(cost.netCents, 10000);
  assert.equal(cost.reviewed, false);
  assert.equal(cost.kind, "transport");
  assert.deepEqual(cost.allocations, []);
  const again = await request(importPath, "POST", body);
  assert.equal(again.data.alreadyRegistered, true);
  const duplicateId = new ObjectId();
  const manual = {
    description: "Duplicado QA",
    date: `${month}-05`,
    kind: "other",
    supplier: "Proveedor QA",
    supplierRuc: "20100066603",
    reference: "fqa-000001",
    netCents: 10000,
    taxCents: 1800,
    allocations: [],
  };
  assert.equal(
    (await request("/costs", "POST", { id: String(duplicateId), data: manual }))
      .status,
    409,
  );
  assert.equal(
    (
      await request(`/costs/${costId}`, "PUT", {
        version: cost.version,
        data: { ...manual, reference: "FQA-9" },
      })
    ).status,
    400,
  );
  // The second invoice is linked to an existing order without another order, stock or material cost.
  await db
    .collection("warehouse_purchases")
    .insertOne({
      _id: orderId,
      version: 1,
      supplier: "Proveedor QA local",
      supplierRuc: "20100066603",
      reason: "Materiales QA",
      workId: "",
      workName: "",
      items: [
        {
          materialId: String(new ObjectId()),
          name: "QA",
          sku: "QA",
          unit: "und",
          requested: 1,
          ordered: 1,
          received: 0,
          unitCents: 10000,
          reason: "QA",
        },
      ],
      receipts: [],
      createdAt: new Date().toISOString(),
      actor: "admin",
      status: "open",
    });
  const beforeOrders = await db
    .collection("warehouse_purchases")
    .countDocuments();
  const beforeStock = await db
    .collection("inventory_movements")
    .countDocuments();
  const secondPath = `/sire/purchases/${second.id}/incorporate`;
  assert.equal(
    (
      await request(secondPath, "POST", {
        ...body,
        version: second.version,
        destination: "warehouse",
        purchaseId: String(new ObjectId()),
      })
    ).status,
    400,
  );
  const saved = await request(secondPath, "POST", {
    ...body,
    version: second.version,
    destination: "warehouse",
    purchaseId: String(orderId),
  });
  assert.equal(saved.status, 201, JSON.stringify(saved));
  const linked = await db
    .collection("accounting_costs")
    .findOne({ _id: new ObjectId(saved.data.costId) });
  assert.equal(linked.purchaseId, String(orderId));
  assert.equal(linked.kind, "purchase");
  assert.deepEqual(linked.allocations, []);
  assert.equal(
    await db.collection("warehouse_purchases").countDocuments(),
    beforeOrders,
  );
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    beforeStock,
  );
  // Persisted after reload and synchronization: no duplicate source rows or costs.
  await request(syncPath + "/" + started.data.job);
  list = await inbox();
  assert.equal(list.registered, 2);
  assert.equal(list.pending, 0);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].version, first.version);
  // Review data changes, unsupported currencies and conflicting source duplicates.
  const make = (number, total = "118.00", currency = "PEN") => {
    const c = Array(40).fill("");
    Object.assign(c, {
      0: "20616656156",
      2: month.replace("-", ""),
      4: `05/${month.slice(5)}/${month.slice(0, 4)}`,
      6: "01",
      7: "FQA",
      9: String(number),
      12: "20100066603",
      13: "Proveedor QA local",
      14: "100.00",
      15: "18.00",
      24: total,
      25: currency,
    });
    return c.join("|");
  };
  const upload = async (lines) => {
    const form = new FormData();
    form.set("file", new Blob([lines.join("\n")]), "propuesta.txt");
    return request(`/period/${month}/reconcile/purchases`, "POST", form);
  };
  assert.equal(
    (
      await upload([
        make(1, "120.00"),
        make(2),
        make(3, "118.00", "USD"),
        make(4),
        make(4),
      ])
    ).status,
    201,
  );
  list = await inbox();
  ids.push(...list.items.map((row) => row.id));
  assert.equal(
    list.items.find((row) => row.reference === "FQA-1").status,
    "different",
  );
  assert.equal(
    list.items.find((row) => row.reference === "FQA-3").status,
    "manual",
  );
  assert.equal(
    list.items.find((row) => row.reference === "FQA-4").status,
    "manual",
  );
  const updated = list.items.find((row) => row.reference === "FQA-1");
  assert.equal(
    (await request(importPath, "POST", { ...body, version: updated.version }))
      .status,
    409,
  );
  // Role gates apply both to the inbox and writes.
  const admin = await db.collection("users").findOne({ username: "admin" });
  try {
    await db
      .collection("users")
      .updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    assert.equal((await request(`/sire/purchases?month=${month}`)).status, 403);
    assert.equal((await request(importPath, "POST", body)).status, 403);
  } finally {
    await db
      .collection("users")
      .updateOne({ _id: admin._id }, { $set: { role: admin.role } });
  }
  console.log(
    "PASS purchases inbox: persistent sync, metadata, concurrent idempotency, manual duplicate protection, CSRF, roles, immutable fiscal fields, warehouse linking without stock/order duplication, changed amounts and manual review.",
  );
} finally {
  await db
    .collection("accounting_costs")
    .deleteMany({ sireSourceId: { $in: ids } });
  await db
    .collection("sire_purchases")
    .deleteMany({ _id: { $in: ids.map((id) => new ObjectId(id)) } });
  await db.collection("warehouse_purchases").deleteOne({ _id: orderId });
  await client.close();
}
