import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  const approve = (id, revision = 1, session = a, status = 201) =>
    req(
      root + `/incidents/${id}/approve`,
      session,
      { revision },
      "POST",
      status,
    );
  await approve(record.id, 1, c, 403);
  await approve(record.id, 1, w, 403);
  await approve(foreign.id, 0, a, 409);
  const waiting = (await approve(record.id)).body;
  assert.equal(waiting.item.status, "approved");
  assert.equal(waiting.applied, false);
  assert.equal((await approve(record.id)).body.applied, false);
  let run = (
    await req(
      root + "/runs",
      a,
      { period, minimumWageCents: 113000, lines: [line] },
      "POST",
      201,
    )
  ).body;
  const loadRun = async () =>
    (await req(root + "?period=" + period, a)).body.runs.find(
      (r) => r.id === run.id,
    );
  assert.equal(run.lines[0].grossCents, 280000);
  assert.equal(run.lines[0].otherDeductionCents, 6000);
  assert.equal(run.lines[0].netCents, 237600);
  assert.equal((await loadRun()).workDeductions.length, 1);
  await req(
    root + "/runs",
    a,
    { period, minimumWageCents: 113000, lines: [line] },
    "POST",
    409,
  );

  await approve(record.id);
  assert.equal((await loadRun()).lines[0].otherDeductionCents, 6000);
  // Bound discounts from the previous workflow remain intact after editing.
  await db
    .collection("work_payroll_incidents")
    .updateOne(
      { _id: new ObjectId(record.id) },
      { $set: { status: "authorized" } },
    );

  await req(
    root + `/runs/${run.id}/work-deductions`,
    a,
    { revision: run.revision, operationId: randomUUID(), incidentIds: [] },
    "POST",
    404,
  );
  await req(path + `/${record.id}/cancel`, c, { revision: 2 }, "POST", 409);
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
    )
  ).body;
  assert.equal(run.lines[0].otherDeductionCents, 6000);
  assert.equal(run.lines[0].grossCents, 290000);
  const second = (
    await req(
      path,
      c,
      { ...data, id: String(new ObjectId()), cents: 1000 },
      "POST",
      201,
    )
  ).body;
  await authorize(second.id);
  await req(
    root + `/runs/${run.id}/status`,
    a,
    { revision: run.revision, status: "approved" },
    "POST",
    409,
  );
  assert.equal((await approve(second.id)).body.applied, true);
  run = await loadRun();
  assert.equal(run.lines[0].otherDeductionCents, 7000);
  const appliedNet = run.lines[0].netCents;
  await approve(second.id);
  assert.equal((await loadRun()).lines[0].netCents, appliedNet);
  const excessive = (
    await req(
      path,
      c,
      { ...data, id: String(new ObjectId()), cents: 900000 },
      "POST",
      201,
    )
  ).body;
  await authorize(excessive.id);
  await approve(excessive.id, 1, a, 400);
  assert.equal(
    (
      await db
        .collection("work_payroll_incidents")
        .findOne({ _id: new ObjectId(excessive.id) })
    ).status,
    "authorized",
  );
  await req(path + `/${excessive.id}/cancel`, c, { revision: 1 }, "POST", 201);
  await approve(excessive.id, 1, a, 409);
  await authorize(foreign.id);
  assert.equal((await approve(foreign.id)).body.applied, false);
  assert.equal((await loadRun()).lines.length, 1);
  const otherLine = {
    ...line,
    employeeId: other.id,
    taxableExtraCents: 0,
    otherDeductionCents: 0,
  };
  run = (
    await req(
      root + `/runs/${run.id}`,
      a,
      {
        period,
        minimumWageCents: 113000,
        lines: [{ ...line, taxableExtraCents: 30000 }, otherLine],
        revision: run.revision,
        manualOtherDeductions: true,
      },
      "PUT",
    )
  ).body;
  assert.equal(run.lines[0].otherDeductionCents, 7000);
  assert.equal(run.lines[1].otherDeductionCents, 5000);
  // Recover a provider success whose local source linkage was interrupted.
  const operation = await db
    .collection("payroll_deduction_operations")
    .findOne({ runId: run.id, state: "done" }, { sort: { createdAt: -1 } });
  await db
    .collection("payroll_deduction_operations")
    .updateOne({ _id: operation._id }, { $set: { state: "pending" } });
  await db
    .collection("work_payroll_incidents")
    .updateOne(
      { _id: new ObjectId(second.id) },
      { $unset: { payrollRunId: "" }, $set: { claimId: operation._id } },
    );
  const recovered = await loadRun();
  assert.equal(recovered.workDeductions.length, 3);
  assert.equal(recovered.deductionPending, undefined);
  assert.equal(recovered.lines[0].netCents, run.lines[0].netCents);
  // A cancelled source with an equal monetary snapshot cannot be resurrected by recovery.
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
  await db
    .collection("work_payroll_incidents")
    .updateOne(
      { _id: new ObjectId(interrupted.id) },
      { $set: { status: "approved", revision: 2 } },
    );
  const opId = randomUUID();
  const input = {
    period,
    minimumWageCents: run.minimumWageCents,
    lines: run.lines.map((row) =>
      Object.fromEntries(Object.keys(line).map((k) => [k, row[k]])),
    ),
  };
  await db.collection("payroll_deduction_operations").insertOne({
    _id: `20616656156:${opId}`,
    issuerRuc: "20616656156",
    runId: run.id,
    revision: run.revision,
    ids: [interrupted.id],
    previousIds: [],
    input,
    hash: "recovery-only",
    state: "pending",
    actor: "QA",
    createdAt: new Date().toISOString(),
  });
  await req(
    path + `/${interrupted.id}/cancel`,
    c,
    { revision: 2 },
    "POST",
    201,
  );
  await loadRun();
  assert.equal(
    (
      await db
        .collection("payroll_deduction_operations")
        .findOne({ _id: `20616656156:${opId}` })
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
  const profile = (await req("/account/payroll?period=" + period, w)).body;
  assert.equal(profile.linked, true);
  assert.equal(profile.line.employeeId, employee.id);
  assert.equal(profile.line.otherDeductionCents, 7000);
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
  assert.equal(otherProfile.line.employeeId, other.id);
  // A new approval cannot change an already approved payroll.
  await db
    .collection("work_payroll_incidents")
    .updateOne(
      { _id: new ObjectId(reportedBeforeClose.id) },
      { $set: { status: "authorized", revision: 1 } },
    );
  await approve(reportedBeforeClose.id, 1, a, 409);
  await req(
    path + `/${reportedBeforeClose.id}/cancel`,
    c,
    { revision: 1 },
    "POST",
    201,
  );
  await req(
    root + `/runs/${run.id}/status`,
    a,
    { revision: run.revision, status: "void" },
    "POST",
    201,
  );
  const replacement = (
    await req(
      root + "/runs",
      a,
      { period, minimumWageCents: 113000, lines: [line, otherLine] },
      "POST",
      201,
    )
  ).body;
  assert.equal(replacement.lines[0].otherDeductionCents, 2000);
  assert.equal(replacement.lines[1].otherDeductionCents, 5000);
  // A legacy source can be approved through the new inbox after its old payroll is voided.
  run = replacement;
  await approve(record.id, 2);
  assert.equal((await loadRun()).lines[0].otherDeductionCents, 7000);
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
    "Personal: vínculo opcional único, privacidad salarial, encargado real de obra, bonos/CTS, sustento, aprobación desde Personal y reflejo automático antes/después de crear la planilla, sin duplicar, recuperación y planilla cerrada y Resumen por permisos: OK.",
  );
} finally {
  await client.close();
}
