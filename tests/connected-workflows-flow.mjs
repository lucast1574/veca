import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import {
  crmLeadDefaults,
  dispatchSchema,
  leadUpdateSchema,
} from "@veca/content";
const base = "http://localhost:4400";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27099";
process.env.NODE_ENV = "test";
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const db = client.db("veca_qa"),
  database = { db },
  tag = "connect-" + randomUUID();
const { CrmRepository } =
  await import("../apps/api/dist/crm/crm.repository.js");
const { InventoryService } =
  await import("../apps/api/dist/inventory/inventory.service.js");
const { SupplyDispatches, stableOperation } =
  await import("../apps/api/dist/inventory/supply-dispatch.service.js");
const { DispatchService } =
  await import("../apps/api/dist/dispatch/dispatch.service.js");
const { WorkGate } = await import("../apps/api/dist/crm/work-gate.service.js");
const repo = new CrmRepository(database),
  events = { emit() {} },
  inventory = new InventoryService(database, repo, events),
  gate = new WorkGate(database);
const workId = String(new ObjectId()),
  otherWork = String(new ObjectId()),
  workerId = new ObjectId(),
  readonlyId = new ObjectId();
let admin, worker, readonly;
const materialIds = [],
  guideIds = [],
  requestIds = [];
async function call(path, session, method = "GET", body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      Cookie: session?.cookie || "",
      "X-Veca-Csrf": session?.csrf || "",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const get = async (p, s = admin, status = 200) =>
  (await call(p, s, "GET", undefined, status)).data;
const post = async (p, b, s = admin, status = 201) =>
  (await call(p, s, "POST", b, status)).data;
async function login(username) {
  const result = await call(
    "/auth/login",
    null,
    "POST",
    { username, password: "Local-only-visual-test-2026!" },
    201,
  );
  return { cookie: result.cookie, csrf: result.data.csrf };
}
const action = (row, name, quantity = 0, extra = {}) =>
  post(`/admin/supply-requests/${row.id}/actions`, {
    operationId: randomUUID(),
    version: row.version,
    action: name,
    quantity,
    note: "",
    ...extra,
  });
async function request(materialId, quantity) {
  let row = await post(`/admin/works/${workId}/supplies`, {
    id: String(new ObjectId()),
    materialId,
    quantity,
    neededBy: "2030-01-04",
    reason: "Materiales para instalar mamparas.",
  });
  requestIds.push(row.id);
  return action(row, "reserve", quantity);
}
async function guide(items, departed = false) {
  const id = String(new ObjectId());
  guideIds.push(id);
  await db.collection("dispatches").insertOne({
    _id: new ObjectId(id),
    leadId: workId,
    workName: tag,
    demo: false,
    status: "accepted",
    version: 1,
    guideNumber: "T001-QA",
    observation: "",
    ...(departed ? { departedAt: new Date().toISOString() } : {}),
    data: dispatchSchema.parse({
      startAddress: "Almacén QA",
      startUbigeo: "150134",
      arrivalAddress: "Av. San Luis 123",
      arrivalUbigeo: "150134",
      transferAt: "2030-01-04T08:00",
      motiveCode: "13",
      motiveDescription: "Instalación",
      recipientType: "6",
      recipientNumber: "20616656156",
      recipientName: "VECA QA",
      transportMode: "02",
      carrierRuc: "",
      carrierName: "",
      vehiclePlate: "ABC123",
      driverDocument: "12345678",
      driverName: "Juan",
      driverLastName: "Pérez",
      driverLicense: "Q12345678",
      weightKg: 10,
      items: items.map(([m, q]) => ({
        materialId: m.id,
        code: m.sku,
        description: m.name,
        unitCode: "NIU",
        quantity: q,
      })),
    }),
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}
async function pending(row, guideId, quantity) {
  const op = {
    operationId: randomUUID(),
    version: row.version,
    action: "deliver",
    quantity,
    guideId,
    note: "Salida conjunta",
    actor: "admin",
    at: new Date().toISOString(),
    completed: false,
  };
  await db.collection("supply_requests").updateOne(
    { _id: new ObjectId(row.id), version: row.version },
    {
      $set: { pending: op },
      $push: { operations: op },
      $inc: { version: 1 },
    },
  );
  return op;
}
function body(op) {
  const { actor, at, completed, ...data } = op;
  return data;
}
try {
  const rootUser = await db.collection("users").findOne({ username: "admin" });
  await db.collection("roles").insertOne({
    id: tag,
    name: "Consulta contable",
    permissions: ["dashboard", "works", "works_all", "accounting"],
    revision: 1,
  });
  await db.collection("users").insertMany([
    {
      _id: workerId,
      username: tag + "worker",
      name: "Instalador QA",
      role: "worker",
      status: "active",
      emailVerified: true,
      passwordHash: rootUser.passwordHash,
    },
    {
      _id: readonlyId,
      username: tag + "reader",
      name: "Consulta QA",
      role: tag,
      status: "active",
      emailVerified: true,
      passwordHash: rootUser.passwordHash,
    },
  ]);
  admin = await login("admin");
  worker = await login(tag + "worker");
  readonly = await login(tag + "reader");
  await db.collection("crm_leads").insertMany(
    [workId, otherWork].map((id) => ({
      ...crmLeadDefaults,
      _id: new ObjectId(id),
      submissionId: randomUUID(),
      name: tag,
      phone: "999111222",
      email: "",
      district: "San Luis",
      requestType: "home",
      idea: "Instalar mamparas y sellar juntas.",
      segment: "low",
      stage: "execution",
      source: "manual",
      version: 1,
      contactResult: "Medidas confirmadas",
      appointment: "2030-01-02T08:00:00-05:00",
      address: "Av. San Luis 123",
      workPlan: "Instalar las mamparas.",
      workHandoff: { status: "accepted" },
      workAssignment: {
        coordinatorId: String(rootUser._id),
        coordinatorName: "admin",
        participantIds: id === workId ? [String(workerId)] : [],
        participantNames: id === workId ? ["Instalador QA"] : [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    })),
  );
  const mats = [];
  for (let i = 0; i < 2; i++) {
    const m = await post("/admin/crm/materials", {
      sku: tag + "-" + i,
      name: "Material QA " + i,
      unit: "unit",
      category: "Selladores",
      location: "A1",
      description: "Prueba aislada",
      minimum: 1,
    });
    mats.push(m);
    materialIds.push(m.id);
    await post(`/admin/crm/materials/${m.id}/movements`, {
      operationId: randomUUID(),
      kind: "receipt",
      quantity: 30,
      leadId: null,
      reason: "Entrada de prueba",
    });
  }
  let a = await request(mats[0].id, 3.2),
    b = await request(mats[0].id, 1.1),
    c = await request(mats[1].id, 2.5);
  const mixed = await guide([
      [mats[0], 4.3],
      [mats[1], 2.5],
    ]),
    op = await pending(a, mixed, 3.2);
  const supplies = new SupplyDispatches(database, inventory, events),
    originalComplete = supplies.complete.bind(supplies);
  let fail = true,
    stockFail = true;
  const originalMove = inventory.move.bind(inventory);
  inventory.move = async (...args) => {
    const result = await originalMove(...args);
    if (stockFail && args[3]?.dispatchId === mixed) {
      stockFail = false;
      throw Error("Injected crash after first stock movement");
    }
    return result;
  };
  supplies.complete = async (batch) => {
    if (fail) {
      fail = false;
      const a = batch.allocations[0];
      await db.collection("supply_requests").updateOne(
        {
          _id: new ObjectId(a.requestId),
          "pending.operationId": a.operation.operationId,
        },
        {
          $inc: { delivered: a.quantity, reserved: -a.quantity, version: 1 },
          $set: { "operations.$[op].completed": true },
        },
        { arrayFilters: [{ "op.operationId": a.operation.operationId }] },
      );
      throw Error("Injected crash after first finalize");
    }
    await originalComplete(batch);
  };
  const dispatch = new DispatchService(
    database,
    repo,
    {},
    inventory,
    supplies,
    gate,
  );
  await assert.rejects(
    () => dispatch.depart(workId, mixed, "admin", a.id),
    /first stock/,
  );
  await assert.rejects(
    () => dispatch.depart(workId, mixed, "admin", a.id),
    /first finalize/,
  );
  assert.equal((await inventory.detail(mats[0].id)).balance, 25.7);
  assert.equal((await inventory.detail(mats[1].id)).balance, 27.5);
  await post(`/admin/supply-requests/${a.id}/actions`, body(op));
  await post(`/admin/supply-requests/${a.id}/actions`, body(op));
  assert.equal(
    await db
      .collection("inventory_movements")
      .countDocuments({ dispatchId: mixed }),
    3,
  );
  for (const [row, quantity] of [
    [a, 3.2],
    [b, 1.1],
    [c, 2.5],
  ]) {
    const saved = await db
      .collection("supply_requests")
      .findOne({ _id: new ObjectId(row.id) });
    assert.equal(saved.delivered, quantity);
    assert.equal(saved.reserved, 0);
    assert.equal(saved.pending, undefined);
  }
  const inbox = await get("/admin/dashboard/inbox", worker);
  assert.equal(inbox.find((s) => s.key === "receipts").count, 3);
  assert(!JSON.stringify(inbox).includes(otherWork));
  for (const row of [a, b, c]) {
    const saved = await db
      .collection("supply_requests")
      .findOne({ _id: new ObjectId(row.id) });
    await post(
      `/admin/works/${workId}/supplies/${row.id}/actions`,
      {
        operationId: randomUUID(),
        version: saved.version,
        action: "receive",
        quantity: saved.delivered,
        note: "Recibido en obra",
      },
      worker,
    );
  }
  assert.equal(
    (await get(`/admin/work-control/${workId}/closeout`)).ready,
    false,
  );
  for (const [m, q] of [
    [mats[0], 4.3],
    [mats[1], 2.5],
  ])
    await post(`/admin/crm/materials/${m.id}/movements`, {
      operationId: randomUUID(),
      kind: "consumption",
      quantity: q,
      leadId: workId,
      reason: "Instalación terminada",
    });
  assert.equal(
    (await get(`/admin/work-control/${workId}/closeout`)).ready,
    true,
  );

  // Preparing a mixed batch aborts before stock and fences a delayed lock.
  const r1 = await request(mats[0].id, 1),
    r2 = await request(mats[0].id, 1),
    r3 = await request(mats[1].id, 1);
  const raceGuide = await guide([
      [mats[0], 2],
      [mats[1], 1],
    ]),
    raceOp = await pending(r1, raceGuide, 1);
  let interfere = true;
  const raceDatabase = {
    db: {
      collection(name) {
        const col = db.collection(name);
        return new Proxy(col, {
          get(target, key) {
            if (name === "supply_requests" && key === "updateOne")
              return async (...args) => {
                if (
                  interfere &&
                  String(args[0]._id) === r2.id &&
                  args[1].$set?.pending
                ) {
                  interfere = false;
                  await target.updateOne(
                    { _id: new ObjectId(r2.id) },
                    { $inc: { version: 1 } },
                  );
                }
                return target.updateOne(...args);
              };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    },
  };
  const racingSupplies = new SupplyDispatches(raceDatabase, inventory, events);
  await assert.rejects(
    () =>
      racingSupplies.prepare(
        raceGuide,
        workId,
        [
          { materialId: mats[0].id, quantity: 2 },
          { materialId: mats[1].id, quantity: 1 },
        ],
        "admin",
        r1.id,
      ),
    (e) => e.getStatus() === 409,
  );
  const frozen = await db
    .collection("supply_dispatches")
    .findOne({ _id: raceGuide });
  assert.equal(frozen.status, "aborted");
  const late = frozen.allocations.find((a) => a.requestId === r3.id);
  const lateWrite = await db.collection("supply_requests").updateOne(
    {
      _id: new ObjectId(r3.id),
      version: late.version,
      pending: { $exists: false },
    },
    { $set: { pending: late.operation } },
  );
  assert.equal(lateWrite.modifiedCount, 0);
  assert.equal(
    await db
      .collection("inventory_movements")
      .countDocuments({ dispatchId: raceGuide }),
    0,
  );
  const fresh = await db
    .collection("supply_requests")
    .findOne({ _id: new ObjectId(r1.id) });
  await post(`/admin/supply-requests/${r1.id}/actions`, {
    operationId: randomUUID(),
    version: fresh.version,
    action: "deliver",
    quantity: 1,
    guideId: raceGuide,
    note: "Preparación repetida tras conflicto",
  });
  // Equipment return is recoverable after its atomic write but before the response.
  const { WarehouseService } =
    await import("../apps/api/dist/inventory/warehouse.service.js");
  const equipment = await post("/admin/warehouse/equipment", {
    id: String(new ObjectId()),
    code: tag,
    name: "Taladro QA",
    location: "Almacén",
    condition: "good",
  });
  let assigned = await post(`/admin/warehouse/equipment/${equipment.id}`, {
    action: "assign",
    version: equipment.version,
    workId,
    responsible: "Instalador QA",
    expectedReturn: "2030-01-04",
    note: "Equipo para instalación",
  });
  let breakReturn = true;
  const faultDb = {
    db: {
      collection(name) {
        const col = db.collection(name);
        return new Proxy(col, {
          get(target, key) {
            if (name === "warehouse_equipment" && key === "findOneAndUpdate")
              return async (...args) => {
                const result = await target.findOneAndUpdate(...args);
                if (breakReturn && args[1].$set?.assignment === null) {
                  breakReturn = false;
                  throw Error("Lost equipment return response");
                }
                return result;
              };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    },
  };
  const warehouse = new WarehouseService(faultDb, repo, inventory, gate);
  const returnInput = {
    action: "return",
    version: assigned.version,
    condition: "good",
    location: "Almacén",
    note: "Equipo devuelto",
  };
  await assert.rejects(
    () => warehouse.equipmentAction(equipment.id, returnInput, "admin"),
    /Lost equipment/,
  );
  assert.equal(
    (await warehouse.equipmentAction(equipment.id, returnInput, "admin"))
      .assignment,
    null,
  );
  assert(!((await repo.get(workId)).activeOperations || []).length);
  await db
    .collection("warehouse_equipment")
    .deleteOne({ _id: new ObjectId(equipment.id) });
  // An unlinked operation guide uses the same creation ID on exact retry.
  const draftId = String(new ObjectId());
  guideIds.push(draftId);
  const sourceGuide = await db
    .collection("dispatches")
    .findOne({ _id: new ObjectId(mixed) });
  const draft = await post(`/admin/crm/leads/${workId}/dispatches`, {
    ...sourceGuide.data,
    creationId: draftId,
  });
  const repeatedDraft = await post(`/admin/crm/leads/${workId}/dispatches`, {
    ...sourceGuide.data,
    creationId: draftId,
  });
  assert.equal(draft.id, repeatedDraft.id);
  const docs = await get(`/admin/work-control/${workId}/financials`);
  assert.equal(docs.guides.find((row) => row.id === draftId).canOpen, false);

  await post(
    `/admin/accounting/guides/${mixed}/discard`,
    { version: 1, observation: "No debe descartar guías aceptadas" },
    admin,
    409,
  );
  await post(
    `/admin/accounting/guides/${draftId}/discard`,
    {
      version: draft.version,
      observation: "No debe cambiar un usuario de consulta",
    },
    readonly,
    403,
  );

  const accountingDraftId = String(new ObjectId());
  guideIds.push(accountingDraftId);
  const accountingDraft = await post("/admin/accounting/guides", {
    id: accountingDraftId,
    leadId: workId,
    data: sourceGuide.data,
  });
  await post(
    `/admin/crm/leads/${workId}/dispatches/${accountingDraft.id}/discard`,
    {
      version: accountingDraft.version,
      observation: "Debe descartarse desde Contabilidad",
    },
    admin,
    404,
  );
  await post(`/admin/accounting/guides/${accountingDraft.id}/discard`, {
    version: accountingDraft.version,
    observation: "Preparación contable no utilizada",
  });
  const discarded = await post(`/admin/accounting/guides/${draftId}/discard`, {
    version: draft.version,
    observation: "Preparación reemplazada por la guía de entrega",
  });
  assert.equal(discarded.status, "discarded");
  await post(
    `/admin/accounting/guides/${draftId}/issue`,
    { version: discarded.version },
    admin,
    409,
  );
  // A committed guide insert with a lost response can be recovered after closing its modal.
  const lostGuide = String(new ObjectId());
  guideIds.push(lostGuide);
  let breakGuide = true;
  const guideDatabase = {
    db: {
      collection(name) {
        const col = db.collection(name);
        return new Proxy(col, {
          get(target, key) {
            if (name === "dispatches" && key === "findOneAndUpdate")
              return async (...args) => {
                const result = await target.findOneAndUpdate(...args);
                if (
                  breakGuide &&
                  String(args[0]._id) === lostGuide &&
                  args[1].$setOnInsert
                ) {
                  breakGuide = false;
                  throw Error("Lost created guide response");
                }
                return result;
              };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    },
  };
  const losingDispatch = new DispatchService(
    guideDatabase,
    repo,
    {},
    inventory,
    supplies,
    gate,
  );
  await assert.rejects(
    () =>
      losingDispatch.create(
        workId,
        { ...sourceGuide.data, creationId: lostGuide },
        "admin",
      ),
    /Lost created guide/,
  );
  await get(`/admin/work-control/${workId}/closeout`);
  assert(
    !((await repo.get(workId)).activeOperations || []).includes(
      `guide:${lostGuide}`,
    ),
  );
  const recoveredGuide = await post(`/admin/crm/leads/${workId}/dispatches`, {
    ...sourceGuide.data,
    creationId: lostGuide,
  });
  assert.equal(recoveredGuide.id, lostGuide);
  // Physical completion keeps an unpaid invoice visible as an economic follow-up.
  await db.collection("accounting_invoices").insertOne({
    _id: new ObjectId(),
    workId: otherWork,
    workName: tag,
    status: "accepted",
    number: "F001-QA",
    netCents: 1000,
    totalCents: 1180,
    paidCents: 0,
  });
  const otherLead = (await get(`/admin/works/${otherWork}`)).lead;
  const closingBody = Object.fromEntries(
    Object.keys(leadUpdateSchema.shape).map((key) => [key, otherLead[key]]),
  );
  const closed = (
    await call(
      `/admin/works/${otherWork}`,
      admin,
      "PUT",
      {
        ...closingBody,
        stage: "completed",
        completionNote: "Instalación revisada y aceptada.",
      },
      200,
    )
  ).data;
  assert.equal(closed.stage, "completed");
  assert.equal(
    (await get(`/admin/work-control/${otherWork}/financials`)).margin.balance,
    1180,
  );
  await post(
    `/admin/works/${otherWork}/supplies`,
    {
      id: String(new ObjectId()),
      materialId: mats[0].id,
      quantity: 1,
      neededBy: "2030-01-04",
      reason: "No debe abrir solicitudes después del cierre",
    },
    admin,
    409,
  );
  // A guide larger than its reservations must not leave a fictitious shortage.
  let insufficient = await request(mats[0].id, 10);
  insufficient = await action(insufficient, "reserve", 6);
  const tooLarge = await guide([[mats[0], 10]]);
  await post(
    `/admin/supply-requests/${insufficient.id}/actions`,
    {
      operationId: randomUUID(),
      version: insufficient.version,
      action: "deliver",
      quantity: 6,
      guideId: tooLarge,
      note: "",
    },
    admin,
    409,
  );
  assert.equal(
    await db
      .collection("inventory_movements")
      .countDocuments({ dispatchId: tooLarge }),
    0,
  );

  const abortRow = await request(mats[0].id, 1),
    abortGuide = await guide([[mats[0], 1]]),
    abortOp = await pending(abortRow, abortGuide, 1);
  const readAttempt = supplies.deliveryAttempt.bind(supplies);
  let cancelDuringClaim = true;
  supplies.deliveryAttempt = async (...args) => {
    const attempt = await readAttempt(...args);
    if (cancelDuringClaim && args[0] === abortGuide) {
      cancelDuringClaim = false;
      await supplies.cancelPreparation(
        abortGuide,
        abortRow.id,
        abortOp,
        workId,
      );
    }
    return attempt;
  };
  await assert.rejects(
    () => dispatch.depart(workId, abortGuide, "admin", abortRow.id),
    (e) => e.getStatus() === 409,
  );
  assert.equal(
    (
      await db
        .collection("dispatches")
        .findOne({ _id: new ObjectId(abortGuide) })
    ).departureSource,
    undefined,
  );
  await db.collection("crm_leads").updateOne(
    { _id: new ObjectId(workId) },
    {
      $addToSet: {
        activeOperations: `cancel-delivery:${abortOp.operationId}`,
      },
    },
  );
  await get(`/admin/work-control/${workId}/closeout`);
  assert(!((await repo.get(workId)).activeOperations || []).length);
  await assert.rejects(
    () => dispatch.depart(workId, abortGuide, "admin", abortRow.id),
    (e) => e.getStatus() === 409,
  );
  // Historical v54 delivery with stock committed and departedAt recorded.
  for (const departed of [false, true]) {
    const row = await request(mats[1].id, 1),
      id = await guide([[mats[1], 1]], departed),
      oldOp = await pending(row, id, 1);
    await inventory.move(
      mats[1].id,
      {
        operationId: stableOperation(`dispatch:${id}:${mats[1].id}`),
        kind: "consumption",
        quantity: 1,
        leadId: workId,
        reason: "Salida con guía T001-QA",
      },
      "admin",
      { dispatchId: id, reservationKey: row.id },
    );
    await assert.rejects(
      () => supplies.cancelPreparation(id, row.id, oldOp, workId),
      (e) => e.getStatus() === 409,
    );
    const before = (await inventory.detail(mats[1].id)).balance;
    await post(`/admin/supply-requests/${row.id}/actions`, body(oldOp));
    const saved = await db
      .collection("supply_requests")
      .findOne({ _id: new ObjectId(row.id) });
    assert.equal(saved.delivered, 1);
    assert.equal(saved.pending, undefined);
    assert.equal((await inventory.detail(mats[1].id)).balance, before);
  }
  await get(`/admin/work-control/${otherWork}/closeout`, worker, 404);
  await get(`/admin/work-control/${workId}/financials`, worker, 403);
  const financials = await get(
    `/admin/work-control/${workId}/financials`,
    readonly,
  );
  assert.equal(financials.margin.workId, workId);
  await post("/admin/accounting/invoices", {}, readonly, 403);
  await post("/admin/accounting/costs", {}, readonly, 403);
  await post("/admin/accounting/guides", {}, readonly, 403);
  await get("/admin/accounting/labor?period=2030-01", readonly, 403);
  // Positive receipts clear durable markers left after a lost successful response.
  await db.collection("crm_leads").updateOne(
    { _id: new ObjectId(workId) },
    {
      $addToSet: {
        activeOperations: {
          $each: [`request:${a.id}`, `departure:${mixed}`, `guide:${mixed}`],
        },
      },
    },
  );
  await get(`/admin/work-control/${workId}/closeout`);
  assert.deepEqual((await repo.get(workId)).activeOperations, []);
  await db
    .collection("crm_leads")
    .updateOne(
      { _id: new ObjectId(workId) },
      { $set: { closingOperation: "test-close" } },
    );
  await assert.rejects(
    () => dispatch.submit(workId, tooLarge, 1, "admin"),
    (e) => e.getStatus() === 409,
  );
  await assert.rejects(
    () => dispatch.issue(tooLarge, 1, "admin"),
    (e) => e.getStatus() === 409,
  );
  await db
    .collection("crm_leads")
    .updateOne(
      { _id: new ObjectId(workId) },
      { $unset: { closingOperation: "" } },
    );
  console.log(
    "PASS connected workflows: mixed guide/3 requests, exact decimal stock, crash+replay, legacy recovery, shortage protection, scoped inbox, closeout, read-only accounting and closing gates.",
  );
} finally {
  await db
    .collection("users")
    .deleteMany({ _id: { $in: [workerId, readonlyId] } });
  await db.collection("roles").deleteOne({ id: tag });
  await db.collection("crm_leads").deleteMany({
    _id: { $in: [workId, otherWork].map((id) => new ObjectId(id)) },
  });
  await db
    .collection("inventory_materials")
    .deleteMany({ _id: { $in: materialIds.map((id) => new ObjectId(id)) } });
  await db.collection("inventory_movements").deleteMany({ leadId: workId });
  await db.collection("supply_requests").deleteMany({ workId });
  await db.collection("dispatches").deleteMany({ leadId: workId });
  await db.collection("supply_dispatches").deleteMany({ workId });
  await db.collection("accounting_invoices").deleteMany({ workId: otherWork });
  await db.collection("warehouse_equipment").deleteMany({ code: tag });
  await client.close();
}
