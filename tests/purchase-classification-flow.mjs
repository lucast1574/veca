import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
const base = "http://localhost:4400";
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
}).format(new Date());
const now = new Date().toISOString();
const materialId = new ObjectId(),
  mealId = new ObjectId(),
  manualId = new ObjectId();
let cookie, csrf;
const sourceIds = [],
  costIds = [];
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
  cookie = login.headers.get("set-cookie").split(";")[0];
  csrf = (await login.json()).csrf;
  async function call(path, method = "GET", body) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: "http://localhost:3300",
        Cookie: cookie,
        "X-Veca-Csrf": csrf,
        "Content-Type": "application/json",
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  }
  async function manual(id, data) {
    let r;
    for (let i = 0; i < 8; i++) {
      r = await call("/admin/accounting/costs", "POST", { id, data });
      if (r.data.check?.status !== "pending") return r;
    }
    throw Error("Manual check never completed");
  }
  const dto = {
    kind: "meals",
    description: "Cena comercial QA",
    date: month + "-05",
    supplier: "Proveedor QA local",
    supplierRuc: "20100066603",
    reference: "FQA-0001",
    netCents: 10000,
    taxCents: 1800,
    allocations: [],
  };
  // Start from an empty inbox: saving manually must fetch SUNAT and redirect without creating a cost.
  await db.collection("sire_purchases").deleteMany({ period: month });
  await db.collection("sire_purchase_syncs").deleteOne({ _id: month });
  const before = await db.collection("accounting_costs").countDocuments();
  const found = await manual(String(mealId), dto);
  assert.equal(found.status, 201);
  assert.equal(found.data.check.status, "found");
  assert.equal(
    await db.collection("accounting_costs").countDocuments(),
    before,
  );
  let list = await call(
    "/admin/accounting/sire/purchases?month=" + month + "&state=all",
  );
  sourceIds.push(...list.data.items.map((r) => r.id));
  const first = list.data.items.find((r) => r.reference === "FQA-1"),
    second = list.data.items.find((r) => r.reference === "FQA-2");
  const beforeOrders = await db
      .collection("warehouse_purchases")
      .countDocuments(),
    beforeStock = await db.collection("inventory_movements").countDocuments();
  const meal = await call(
    `/admin/accounting/sire/purchases/${first.id}/incorporate`,
    "POST",
    {
      version: first.version,
      description: dto.description,
      destination: "general",
      kind: "meals",
    },
  );
  assert.equal(meal.status, 201, JSON.stringify(meal));
  costIds.push(meal.data.costId);
  const mealCost = await db
    .collection("accounting_costs")
    .findOne({ _id: new ObjectId(meal.data.costId) });
  assert.equal(mealCost.kind, "meals");
  assert.equal(mealCost.purchaseId, undefined);
  assert.equal(
    await db.collection("warehouse_purchases").countDocuments(),
    beforeOrders,
  );
  const duplicate = await manual(String(manualId), dto);
  assert.equal(duplicate.data.check.status, "registered");
  assert.equal(duplicate.data.check.costId, meal.data.costId);
  assert.equal(
    await db.collection("accounting_costs").countDocuments(),
    before + 1,
  );
  // Materials create one durable requested order and one invoice record, never stock.
  const body = {
    version: second.version,
    description: "Vidrios para almacén QA",
    destination: "warehouse",
    kind: "other",
  };
  const routedCalls = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(
        `/admin/accounting/sire/purchases/${second.id}/incorporate`,
        "POST",
        body,
      ),
    ),
  );
  assert.ok(
    routedCalls.every((row) => row.status === 201),
    JSON.stringify(routedCalls),
  );
  const routed = routedCalls[0];
  assert.ok(routedCalls.every((row) => row.data.costId === routed.data.costId));
  assert.equal(routed.status, 201, JSON.stringify(routed));
  costIds.push(routed.data.costId);
  const cost = await db
    .collection("accounting_costs")
    .findOne({ _id: new ObjectId(routed.data.costId) });
  assert.equal(cost.kind, "purchase");
  assert.ok(cost.purchaseId);
  assert.equal(cost.warehouseRoutingPending, false);
  const unlink = await call(
    "/admin/accounting/costs/" + String(cost._id),
    "PUT",
    {
      version: cost.version,
      data: {
        ...dto,
        kind: "purchase",
        reference: cost.reference,
        date: cost.date,
      },
    },
  );
  assert.equal(
    unlink.status,
    409,
    "An active warehouse task cannot lose its invoice link",
  );
  let purchase = await call("/admin/warehouse/purchases/" + cost.purchaseId);
  assert.equal(purchase.data.status, "requested");
  assert.equal(purchase.data.items.length, 0);
  assert.equal(purchase.data.invoiceSource.reference, "FQA-2");
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    beforeStock,
  );
  assert.equal(
    await db.collection("warehouse_purchases").countDocuments(),
    beforeOrders + 1,
  );
  const admin = await db.collection("users").findOne({ username: "admin" });
  const notices = await db
    .collection("notifications")
    .find({
      userId: String(admin._id),
      href: "#inventory/compras/" + cost.purchaseId,
    })
    .toArray();
  assert.equal(
    notices.length,
    1,
    "warehouse receives one deduplicated internal notice",
  );
  await call(
    `/admin/accounting/sire/purchases/${second.id}/incorporate`,
    "POST",
    body,
  );
  assert.equal(
    await db.collection("warehouse_purchases").countDocuments(),
    beforeOrders + 1,
  );
  await db.collection("inventory_materials").insertOne({
    _id: materialId,
    sku: "QA-CLASSIFY",
    name: "Vidrio QA",
    unit: "unidad",
    balanceMilli: 0,
    pending: [],
    minimumMilli: 0,
    updatedAt: now,
    version: 1,
  });
  const order = {
    id: cost.purchaseId,
    workId: "",
    supplier: purchase.data.supplier,
    supplierRuc: dto.supplierRuc,
    reason: body.description,
    items: [
      {
        materialId: String(materialId),
        requested: 0,
        ordered: 2,
        unitCents: 5000,
        reason: "Compra facturada QA",
      },
    ],
  };
  const prepared = await call(
    "/admin/warehouse/purchases/" + cost.purchaseId + "/order",
    "PUT",
    order,
  );
  assert.equal(prepared.status, 200, JSON.stringify(prepared));
  assert.equal(prepared.data.status, "open");
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    beforeStock,
  );
  const receive = {
    operationId: randomUUID(),
    materialId: String(materialId),
    quantity: 2,
    reference: "FQA-2",
  };
  const received = await call(
    "/admin/warehouse/purchases/" + cost.purchaseId + "/receive",
    "POST",
    receive,
  );
  assert.equal(received.status, 201, JSON.stringify(received));
  assert.equal(received.data.status, "received");
  await call(
    "/admin/warehouse/purchases/" + cost.purchaseId + "/receive",
    "POST",
    receive,
  );
  assert.equal(
    await db.collection("inventory_movements").countDocuments(),
    beforeStock + 1,
  );
  assert.equal(
    (await db.collection("inventory_materials").findOne({ _id: materialId }))
      .balanceMilli,
    2000,
  );
  // A supplier outage cannot silently create an unchecked duplicate.
  const outage = await manual(String(new ObjectId()), {
    ...dto,
    date: "2026-05-05",
    reference: "FOUT-99",
  });
  assert.equal(outage.status, 503);
  assert.equal(
    await db.collection("accounting_costs").countDocuments(),
    before + 2,
  );
  // Unmatched invoices can still be entered directly and classified without touching warehouse.
  const entered = await manual(String(manualId), {
    ...dto,
    reference: "FMAN-99",
    kind: "services",
    description: "Servicio externo QA",
  });
  assert.equal(entered.status, 201);
  assert.ok(entered.data.id, JSON.stringify(entered));
  costIds.push(entered.data.id);
  assert.equal(
    await db.collection("warehouse_purchases").countDocuments(),
    beforeOrders + 1,
  );
  console.log(
    "PASS classification: fresh SUNAT lookup, duplicate handoff, meals/services stay outside warehouse, warehouse task/notice, preparation without stock, receipt exactly once, outage protection and manual unmatched records.",
  );
} finally {
  await db.collection("notifications").deleteMany({
    href: { $in: costIds.map((id) => "#inventory/compras/" + id) },
  });
  await db
    .collection("warehouse_purchases")
    .deleteMany({ "invoiceSource.costId": { $in: costIds } });
  await db
    .collection("accounting_costs")
    .deleteMany({ _id: { $in: costIds.map((id) => new ObjectId(id)) } });
  await db
    .collection("sire_purchases")
    .deleteMany({ _id: { $in: sourceIds.map((id) => new ObjectId(id)) } });
  await db
    .collection("inventory_movements")
    .deleteMany({ materialId: String(materialId) });
  await db.collection("inventory_materials").deleteOne({ _id: materialId });
  await client.close();
}
