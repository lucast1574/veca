import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "@veca/content";
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect(),
  db = client.db("veca_qa");
const api = "http://localhost:4400",
  root = "/admin/accounting/labor";
const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  period = date.slice(0, 7);
async function req(
  path,
  session,
  data,
  method = data === undefined ? "GET" : "POST",
  status = 200,
) {
  const r = await fetch(api + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(session
        ? { Cookie: session.cookie, "X-Veca-Csrf": session.csrf }
        : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (status !== null) assert.equal(r.status, status, `${path} ${text}`);
  return {
    body,
    status: r.status,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(username) {
  const r = await req(
    "/auth/login",
    null,
    { username, password: "Local-only-visual-test-2026!" },
    "POST",
    201,
  );
  return { cookie: r.cookie, csrf: r.body.csrf };
}
const adminDoc = await db.collection("users").findOne({ username: "admin" });
const ids = Object.fromEntries(
  ["coordinator", "other", "worker", "worker2"].map((k) => [k, new ObjectId()]),
);
const prefix = "personnel-" + randomUUID();
try {
  for (const [name, _id] of Object.entries(ids))
    await db.collection("users").insertOne({
      _id,
      username: prefix + name,
      name,
      status: "active",
      emailVerified: true,
      role: name.startsWith("worker") ? "worker" : "operations",
      passwordHash: adminDoc.passwordHash,
    });
  const sessions = { admin: await login("admin") };
  for (const name of Object.keys(ids))
    sessions[name] = await login(prefix + name);
  const a = sessions.admin,
    c = sessions.coordinator,
    w = sessions.worker,
    o = sessions.other,
    w2 = sessions.worker2;
  const employeeData = {
    name: "Técnico principal QA",
    documentType: "DNI",
    documentNumber: "70000001",
    position: "Técnico",
    hireDate: "2025-01-01",
    salaryCents: 260000,
    pensionSystem: "onp",
    laborRegime: "general",
    healthSystem: "essalud",
    regimeReference: "",
    active: true,
  };
  const employee = (
    await req(root + "/employees", a, employeeData, "POST", 201)
  ).body;
  const other = (
    await req(
      root + "/employees",
      a,
      {
        ...employeeData,
        name: "Otro técnico QA",
        documentNumber: "70000002",
        salaryCents: 240000,
      },
      "POST",
      201,
    )
  ).body;
  const link = (id, user, revision = 0, status = 200) =>
    req(
      root + `/accounts/${id}`,
      a,
      { userId: String(user), revision },
      "PUT",
      status,
    );
  await link(employee.id, ids.worker);
  await link(other.id, ids.worker, 0, 409);
  await link(other.id, ids.worker2);
  await req(root + "/accounts", w, undefined, "GET", 403);
  assert.equal(
    (await req("/account/payroll?period=" + period, c)).body.linked,
    false,
  );
  const work1 = new ObjectId(),
    work2 = new ObjectId();
  for (const [id, coordinator, workers] of [
    [work1, ids.coordinator, [ids.worker]],
    [work2, ids.other, [ids.worker2]],
  ])
    await db.collection("crm_leads").insertOne({
      ...crmLeadDefaults,
      _id: id,
      name: "Obra " + id,
      workName: "Obra " + id,
      stage: "execution",
      source: "manual",
      submissionId: randomUUID(),
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      events: [],
      workAssignment: {
        coordinatorId: String(coordinator),
        participantIds: workers.map(String),
      },
    });
  const path = `/admin/works/${work1}/payroll-incidents`;
  const data = {
    id: String(new ObjectId()),
    employeeId: employee.id,
    date,
    period,
    kind: "waste",
    item: "Vidrio templado",
    quantityNote: "1 m²",
    reason: "Corte fuera de las medidas de trabajo aprobadas.",
    cents: 5000,
  };
  await req(path, w, data, "POST", 403);
  await req(path, o, data, "POST", 403);
  const record = (await req(path, c, data, "POST", 201)).body;
  assert.equal((await req(path, c, data, "POST", 201)).body.id, record.id);
  await req(path, c, { ...data, cents: 6000 }, "POST", 409);
  assert.ok(
    (await req(path, c)).body.employees.every(
      (e) => !("salaryCents" in e) && !("documentNumber" in e),
    ),
  );
  assert.equal((await req(path, o)).body.canManage, false);
  await req(
    path + `/${record.id}/authorize`,
    o,
    {
      revision: 0,
      basis: "agreement",
      reference: "Autorización QA",
      confirmed: true,
    },
    "POST",
    403,
  );
  await req(
    path + `/${record.id}/authorize`,
    c,
    {
      revision: 0,
      basis: "agreement",
      reference: "Autorización QA",
      confirmed: false,
    },
    "POST",
    400,
  );
  const authorize = async (id, rev = 0) =>
    (
      await req(
        path + `/${id}/authorize`,
        c,
        {
          revision: rev,
          basis: "agreement",
          reference: "Autorización firmada QA-2026",
          confirmed: true,
        },
        "POST",
        201,
      )
    ).body;
  await authorize(record.id);
  const foreign = (
    await req(
      path,
      a,
      { ...data, id: String(new ObjectId()), employeeId: other.id },
      "POST",
      201,
    )
  ).body;
  assert.equal((await req(path, w)).body.items.length, 1);
  await req(
    `/admin/works/${work2}/payroll-incidents`,
    w,
    undefined,
    "GET",
    404,
  );
  const line = {
    employeeId: employee.id,
    days: 30,
    taxableExtraCents: 20000,
    nonTaxableCents: 0,
    afpDeductionCents: 0,
    employerContributionCents: 0,
    gratuityCents: 0,
    ctsCents: 65000,
    vacationCents: 0,
    fifthCategoryCents: 0,
    otherDeductionCents: 1000,
  };
  let run = (
    await req(
      root + "/runs",
      a,
      { period, minimumWageCents: 113000, lines: [line] },
      "POST",
      201,
    )
  ).body;
  assert.equal(run.lines[0].grossCents, 280000);
  assert.equal(run.lines[0].netCents, 242600);
  await req(
    root + `/runs/${run.id}/status`,
    a,
    { revision: run.revision, status: "approved" },
    "POST",
    409,
  );
  await req(
    root + `/runs/${run.id}/work-deductions`,
    a,
    {
      revision: run.revision,
      operationId: randomUUID(),
      incidentIds: [foreign.id],
    },
    "POST",
    409,
  );
  const apply = {
    revision: run.revision,
    operationId: randomUUID(),
    incidentIds: [record.id],
  };
  run = (
    await req(root + `/runs/${run.id}/work-deductions`, a, apply, "POST", 201)
  ).body;
  assert.equal(run.lines[0].otherDeductionCents, 6000);
  assert.equal(run.lines[0].netCents, 237600);
  assert.equal(
    (await req(root + `/runs/${run.id}/work-deductions`, a, apply, "POST", 201))
      .body.lines[0].otherDeductionCents,
    6000,
  );
  const ledger = await req(root + "?period=" + period, a);
  assert.equal(
    ledger.body.runs.find((r) => r.id === run.id).workDeductions.length,
    1,
  );
  const again = (
    await req(
      root + `/runs/${run.id}/work-deductions`,
      a,
      {
        revision: run.revision,
        operationId: randomUUID(),
        incidentIds: [record.id],
      },
      "POST",
      201,
    )
  ).body;
  assert.equal(again.lines[0].otherDeductionCents, 6000);
  await req(
    root + `/runs/${run.id}`,
    a,
    { period, minimumWageCents: 113000, lines: [line], revision: run.revision },
    "PUT",
    409,
  );
  run = (
    await req(
      root + `/runs/${run.id}`,
      a,
      {
        period,
        minimumWageCents: 113000,
        lines: [{ ...line, taxableExtraCents: 30000 }],
        revision: run.revision,
        manualOtherDeductions: true,
      },
      "PUT",
      200,
    )
  ).body;
  assert.equal(run.lines[0].otherDeductionCents, 6000);
  assert.equal(run.lines[0].grossCents, 290000);
  await req(path + `/${record.id}/cancel`, c, { revision: 1 }, "POST", 409);
  run = (
    await req(
      root + `/runs/${run.id}/work-deductions`,
      a,
      { revision: run.revision, operationId: randomUUID(), incidentIds: [] },
      "POST",
      201,
    )
  ).body;
  assert.equal(run.lines[0].otherDeductionCents, 1000);
  await req(path + `/${record.id}/cancel`, c, { revision: 1 }, "POST", 201);
  // Simulate an interrupted operation before incident claims were persisted.
  const interrupted = (
    await req(
      path,
      c,
      { ...data, id: String(new ObjectId()), cents: 1000 },
      "POST",
      201,
    )
  ).body;
  await authorize(interrupted.id);
  const operationId = randomUUID(),
    input = {
      period,
      minimumWageCents: run.minimumWageCents,
      lines: [{ ...line, taxableExtraCents: 30000, otherDeductionCents: 2000 }],
    };
  await db.collection("payroll_deduction_operations").insertOne({
    _id: `20616656156:${operationId}`,
    issuerRuc: "20616656156",
    runId: run.id,
    revision: run.revision,
    ids: [interrupted.id],
    previousIds: [],
    input,
    hash: createHash("sha256")
      .update(
        JSON.stringify({
          runId: run.id,
          revision: run.revision,
          ids: [interrupted.id],
        }),
      )
      .digest("hex"),
    state: "pending",
    actor: "QA",
    createdAt: new Date().toISOString(),
  });
  await req(
    path + `/${interrupted.id}/cancel`,
    c,
    { revision: 1 },
    "POST",
    201,
  );
  await req(
    root + `/runs/${run.id}/work-deductions`,
    a,
    { revision: run.revision, operationId, incidentIds: [interrupted.id] },
    "POST",
    409,
  );
  assert.equal(
    (
      await db
        .collection("payroll_deduction_operations")
        .findOne({ _id: `20616656156:${operationId}` })
    ).state,
    "failed",
  );
  // Equal monetary snapshots must not resurrect a source cancelled before claims.
  const noChangeId = randomUUID();
  await db.collection("payroll_deduction_operations").insertOne({
    _id: `20616656156:${noChangeId}`,
    issuerRuc: "20616656156",
    runId: run.id,
    revision: run.revision,
    ids: [interrupted.id],
    previousIds: [],
    input: {
      ...input,
      lines: [{ ...input.lines[0], otherDeductionCents: 1000 }],
    },
    hash: "recovery-only",
    state: "pending",
    actor: "QA",
    createdAt: new Date().toISOString(),
  });
  await req(root + "?period=" + period, a);
  assert.equal(
    (
      await db
        .collection("payroll_deduction_operations")
        .findOne({ _id: `20616656156:${noChangeId}` })
    ).state,
    "failed",
  );
  assert.equal(
    (
      await db
        .collection("work_payroll_incidents")
        .findOne({ _id: new ObjectId(interrupted.id) })
    ).payrollRunId,
    undefined,
  );
  // A saved provider response with an unfinished local binding is recovered without another deduction.
  const finalIncident = (
    await req(path, c, { ...data, id: String(new ObjectId()) }, "POST", 201)
  ).body;
  await authorize(finalIncident.id);
  const lastApply = {
    revision: run.revision,
    operationId: randomUUID(),
    incidentIds: [finalIncident.id],
  };
  run = (
    await req(
      root + `/runs/${run.id}/work-deductions`,
      a,
      lastApply,
      "POST",
      201,
    )
  ).body;
  await db
    .collection("payroll_deduction_operations")
    .updateOne(
      { _id: `20616656156:${lastApply.operationId}` },
      { $set: { state: "pending" } },
    );
  await db.collection("work_payroll_incidents").updateOne(
    { _id: new ObjectId(finalIncident.id) },
    {
      $unset: { payrollRunId: "" },
      $set: { claimId: `20616656156:${lastApply.operationId}` },
    },
  );
  const recovered = (await req(root + "?period=" + period, a)).body.runs.find(
    (r) => r.id === run.id,
  );
  assert.equal(recovered.workDeductions.length, 1);
  assert.equal(recovered.lines[0].otherDeductionCents, 6000);
  assert.equal(recovered.deductionPending, undefined);
  const reportedBeforeClose = (
    await req(path, c, { ...data, id: String(new ObjectId()) }, "POST", 201)
  ).body;
  run = (
    await req(
      root + `/runs/${run.id}/status`,
      a,
      { revision: run.revision, status: "approved" },
      "POST",
      201,
    )
  ).body;
  await req(path, c, { ...data, id: String(new ObjectId()) }, "POST", 409);
  await req(
    path + `/${reportedBeforeClose.id}/authorize`,
    c,
    {
      revision: 0,
      basis: "agreement",
      reference: "Autorización QA",
      confirmed: true,
    },
    "POST",
    409,
  );
  await req(
    root + `/runs/${run.id}`,
    a,
    {
      period,
      minimumWageCents: 113000,
      lines: [line],
      revision: run.revision,
      manualOtherDeductions: true,
    },
    "PUT",
    409,
  );
  await req(
    root + `/runs/${run.id}/work-deductions`,
    a,
    { revision: run.revision, operationId: randomUUID(), incidentIds: [] },
    "POST",
    409,
  );
  const profile = (await req("/account/payroll?period=" + period, w)).body;
  assert.equal(profile.linked, true);
  assert.equal(profile.line.employeeId, employee.id);
  assert.equal(profile.line.otherDeductionCents, 6000);
  assert.equal(profile.line.taxableExtraCents, 30000);
  assert.equal(profile.line.ctsCents, 65000);
  assert.equal(profile.run.status, "approved");
  assert.equal(
    profile.incidents.some((i) => i.id === foreign.id),
    false,
  );
  assert.equal(JSON.stringify(profile).includes(other.name), false);
  const otherProfile = (
    await req(`/account/payroll?period=${period}&userId=${ids.worker}`, w2)
  ).body;
  assert.equal(otherProfile.employeeName, other.name);
  assert.equal(otherProfile.line, null);
  const stockId = new ObjectId();
  await db.collection("inventory_materials").insertOne({
    _id: stockId,
    sku: "QA-RES",
    name: "Reservas QA",
    unit: "m2",
    balanceMilli: 10000,
    minimumMilli: 3000,
    reservations: { QA: { workId: String(work1), quantity: 8000 } },
  });
  const dashboard = (await req("/admin/dashboard", a)).body;
  assert.equal(dashboard.visuals.stock.low, 1);
  assert.equal(
    dashboard.lowStock.find((m) => m.id === String(stockId)).balance,
    2,
  );
  assert.equal(dashboard.visuals.activity.length, 6);
  const ownDashboard = (await req("/admin/dashboard", w)).body;
  assert.equal(ownDashboard.visuals.workStages.execution, 1);
  assert.equal(ownDashboard.visuals.stock, null);
  assert.ok(ownDashboard.visuals.activity.every((m) => m.received === null));
  assert.equal(ownDashboard.accounting, null);
  const unlinked = await req(
    root + `/accounts/${employee.id}`,
    a,
    { userId: null, revision: 1 },
    "PUT",
    200,
  );
  assert.equal(unlinked.body.ok, true);
  assert.equal(
    (await req("/account/payroll?period=" + period, w)).body.linked,
    false,
  );
  console.log(
    "Personal: vínculo opcional único, privacidad salarial, encargado real de obra, bonos/CTS, sustento, descuentos sin duplicar, recuperación, planilla cerrada y Resumen por permisos: OK.",
  );
} finally {
  await client.close();
}
