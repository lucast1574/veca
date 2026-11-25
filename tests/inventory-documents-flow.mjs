import sharp from "sharp";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "@veca/content";
const base = "http://localhost:4400";
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
let cookie = "",
  csrf = "";
async function call(
  path,
  data,
  method = data === undefined ? "GET" : "POST",
  expected = 200,
) {
  const multipart = data instanceof FormData;
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      Cookie: cookie,
      "X-Veca-Csrf": csrf,
      ...(data !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      data === undefined ? undefined : multipart ? data : JSON.stringify(data),
  });
  const content = await response.text();
  let body;
  try {
    body = JSON.parse(content);
  } catch {
    body = content;
  }
  if (expected !== null)
    assert.equal(response.status, expected, `${path}: ${content}`);
  if (path === "/auth/login") {
    cookie = response.headers.get("set-cookie").split(";")[0];
    csrf = body.csrf;
  }
  return { status: response.status, body, headers: response.headers };
}
const id = String(new ObjectId()),
  worker = String(new ObjectId());
const root = `/admin/crm/leads/${id}`,
  work = `/admin/works/${id}`,
  plan = `/admin/warehouse/works/${id}`;
const admin = await db.collection("users").findOne({ username: "admin" });
const quote = {
  reference: "COT-QA-01",
  date: "2026-11-25",
  validUntil: "2026-12-10",
  currency: "PEN",
  salesNetCents: 1000000,
  taxRate: 18,
  taxCents: 180000,
  costBudgetCents: 700000,
  advanceCents: 590000,
  paymentTerms: "Saldo a la entrega",
  durationDays: 30,
  durationType: "working",
  executionTerms: "Desde el adelanto",
  notes: "",
};
function upload(type, quotation) {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"], {
      type: "application/pdf",
    }),
    "Plano y cotización QA.pdf",
  );
  form.append("documentType", type);
  if (quotation !== undefined)
    form.append("quotation", JSON.stringify(quotation));
  return form;
}
try {
  await db.collection("users").insertOne({
    _id: new ObjectId(worker),
    username: `worker-${id}`,
    role: "worker",
    name: "Trabajador QA",
    status: "active",
    emailVerified: true,
    passwordHash: admin.passwordHash,
  });
  await db.collection("crm_leads").insertOne({
    ...crmLeadDefaults,
    _id: new ObjectId(id),
    name: "Obra de integridad QA",
    stage: "execution",
    submissionId: randomUUID(),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    workAssignment: {
      coordinatorId: String(admin._id),
      participantIds: [worker],
    },
  });
  await call(
    "/auth/login",
    { username: "admin", password: "Local-only-visual-test-2026!" },
    "POST",
    201,
  );
  await call(root + "/files", upload("quotation"), "POST", 400);
  await call(
    root + "/files",
    upload("quotation", { ...quote, advanceCents: 1180001 }),
    "POST",
    400,
  );
  await call(
    root + "/files",
    upload("quotation", { ...quote, taxCents: 1 }),
    "POST",
    400,
  );
  assert.equal(
    await db.collection("crm_files").countDocuments({ leadId: id }),
    0,
  );
  const quotation = (
    await call(root + "/files", upload("quotation", quote), "POST", 201)
  ).body;
  const drawing = (await call(work + "/files", upload("plan"), "POST", 201))
    .body;
  assert.equal(quotation.type, "quotation");
  assert.equal(quotation.leadId, id);
  assert.equal(
    (await call(plan.replace(id, id.toUpperCase()))).body.plan.budgetCents,
    quote.costBudgetCents,
  );
  assert.equal(drawing.type, "plan");
  const detail = (await call(work)).body;
  assert.equal(detail.attachments.length, 2);
  const download = await call(`/admin/crm/files/${quotation.id}`);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.match(download.headers.get("content-disposition"), /filename\*=UTF-8/);
  let planning = (await call(plan)).body.plan;
  assert.equal(planning.budgetCents, 700000);
  assert.equal(planning.budgetSource.attachmentId, quotation.id);
  await call(
    plan,
    {
      revision: planning.revision,
      budgetCents: 123,
      materials: [],
      equipment: [],
    },
    "PUT",
    409,
  );
  await call(
    plan,
    {
      revision: planning.revision,
      budgetCents: 700000,
      materials: [],
      equipment: [],
    },
    "PUT",
    200,
  );
  await call(
    root + "/files",
    upload("quotation", {
      ...quote,
      reference: "COT-QA-02",
      costBudgetCents: 750000,
    }),
    "POST",
    201,
  );
  const margin = (await call(`/admin/accounting/margin/${id}`)).body;
  assert.equal(margin.budgetCents, 750000);
  assert.equal(margin.quotation.reference, "COT-QA-02");
  assert.equal(margin.sales, 0);
  assert.equal(margin.paid, 0);
  // Plans retain the original image bytes and resolution for legibility.
  const original = await sharp({
    create: { width: 3100, height: 20, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const imageForm = new FormData();
  imageForm.append(
    "file",
    new Blob([original], { type: "image/jpeg" }),
    "plano.jpg",
  );
  imageForm.append("documentType", "plan");
  const imagePlan = (await call(work + "/files", imageForm, "POST", 201)).body;
  const imageResponse = await fetch(base + imagePlan.url, {
    headers: { Cookie: cookie },
  });
  assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), original);
  // Many photos must not hide essential documents from the summary.
  await db.collection("crm_files").insertMany(
    Array.from({ length: 105 }, () => ({
      _id: new ObjectId(),
      leadId: id,
      name: "Foto",
      type: "photo",
      createdAt: "2099-01-01T00:00:00.000Z",
      caption: "",
      tags: [],
      sharing: "internal",
      revision: 1,
    })),
  );
  assert.ok(
    (await call(work)).body.attachments.some((a) => a.id === drawing.id),
  );
  await call(
    "/auth/login",
    { username: `worker-${id}`, password: "Local-only-visual-test-2026!" },
    "POST",
    201,
  );
  const workerDetail = (await call(work)).body;
  assert.ok(workerDetail.attachments.some((a) => a.type === "plan"));
  assert.ok(workerDetail.attachments.every((a) => a.type !== "quotation"));
  await call(work + `/files/${quotation.id}`, undefined, "GET", 404);
  await call(work + `/files/${drawing.id}`);
  await call(work + "/files", upload("quotation", quote), "POST", 400);
  await call(
    `/admin/supply-requests/${new ObjectId()}/guide-request`,
    { version: 1, transferAt: "2099-01-01T12:00" },
    "POST",
    403,
  );
  await call(
    "/auth/login",
    { username: "admin", password: "Local-only-visual-test-2026!" },
    "POST",
    201,
  );
  const material = (
    await call(
      "/admin/crm/materials",
      {
        sku: `MAT-${id}`,
        name: "Vidrio QA",
        unit: "m2",
        category: "Vidrio",
        location: "Rack A",
        description: "Material QA",
        minimum: 1,
      },
      "POST",
      201,
    )
  ).body;
  await call(
    `/admin/crm/materials/${material.id}/movements`,
    {
      operationId: randomUUID(),
      kind: "receipt",
      quantity: 10,
      reason: "Entrada de prueba",
      leadId: null,
    },
    "POST",
    201,
  );
  const request = (
    await call(
      work + "/supplies",
      {
        id: String(new ObjectId()),
        materialId: material.id,
        quantity: 6,
        neededBy: "2099-01-02",
        reason: "Vidrio para la fachada QA",
      },
      "POST",
      201,
    )
  ).body;
  const reserved = (
    await call(
      `/admin/supply-requests/${request.id}/actions`,
      {
        operationId: randomUUID(),
        version: request.version,
        action: "reserve",
        quantity: 6,
        note: "",
      },
      "POST",
      201,
    )
  ).body;
  const guidePath = `/admin/supply-requests/${request.id}/guide-request`;
  await call(
    guidePath,
    { version: reserved.version - 1, transferAt: "2099-01-01T12:00" },
    "POST",
    409,
  );
  await call(
    guidePath,
    { version: reserved.version, transferAt: "2020-01-01T12:00" },
    "POST",
    400,
  );
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(
        guidePath,
        { version: reserved.version, transferAt: "2099-01-01T12:00" },
        "POST",
        null,
      ),
    ),
  );
  assert.ok(
    results.every((r) => [201, 409].includes(r.status)),
    JSON.stringify(results),
  );
  let guides = await db
    .collection("dispatches")
    .find({ supplyRequestId: request.id })
    .toArray();
  assert.equal(guides.length, 1);
  assert.equal(guides[0].status, "review");
  assert.equal(guides[0].data.items[0].quantity, 6);
  assert.equal(guides[0].externalId, undefined);
  assert.equal(guides[0].departedAt, undefined);
  assert.equal(guides[0].data.startAddress, "");
  const retry = (
    await call(
      guidePath,
      { version: reserved.version, transferAt: "2099-01-02T12:00" },
      "POST",
      201,
    )
  ).body;
  assert.equal(retry.id, String(guides[0]._id));
  assert.equal(
    (await call(`/admin/crm/materials/${material.id}`)).body.balance,
    10,
  );
  assert.equal(
    (await call(`/admin/supply-requests/${request.id}`)).body.items[0]
      .guideRequest.id,
    retry.id,
  );
  assert.ok(
    await db.collection("notifications").findOne({
      href: `#accounting/guias/${retry.id}`,
      title: "Guía de remisión solicitada",
    }),
  );
  await call(
    `/admin/accounting/guides/${retry.id}/discard`,
    { version: retry.version, observation: "Prueba de nueva solicitud" },
    "POST",
    201,
  );
  const renewed = (
    await call(
      guidePath,
      { version: reserved.version, transferAt: "2099-01-03T12:00" },
      "POST",
      201,
    )
  ).body;
  assert.notEqual(renewed.id, retry.id);
  assert.equal(
    await db
      .collection("dispatches")
      .countDocuments({ activeSupplyRequestId: request.id }),
    1,
  );
  const eq = (
    await call(
      "/admin/warehouse/equipment",
      {
        id: String(new ObjectId()),
        code: `EQ-${id}`,
        name: "Taladro QA",
        category: "tool",
        location: "Almacén",
        condition: "good",
      },
      "POST",
      201,
    )
  ).body;
  const updated = (
    await call(
      `/admin/warehouse/equipment/${eq.id}`,
      {
        version: eq.version,
        code: eq.code,
        name: eq.name,
        category: "machine",
        location: eq.location,
      },
      "PUT",
      200,
    )
  ).body;
  assert.equal(updated.category, "machine");
  assert.equal(updated.version, eq.version + 1);
  await call(
    `/admin/warehouse/equipment/${eq.id}`,
    {
      version: eq.version,
      code: eq.code,
      name: eq.name,
      category: "tool",
      location: eq.location,
    },
    "PUT",
    409,
  );
  console.log(
    "Cotización validada, presupuesto único, permisos de documentos, guía sin duplicados ni stock, aviso contable y categorías de equipo: OK.",
  );
} finally {
  await client.close();
}
