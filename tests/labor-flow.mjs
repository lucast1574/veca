import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "../packages/content/dist/index.js";

// Run with VECA_GUIDE_QA_MOCK=1 node scripts/local-qa.mjs in the isolated environment.
const accounting = "/admin/accounting";
const root = accounting + "/labor";
let cookie, csrf;
async function request(path, status = 200, method = "GET", data) {
  const response = await fetch("http://localhost:4400" + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(cookie && { Cookie: cookie, "X-Veca-Csrf": csrf }),
      ...(data && { "Content-Type": "application/json" }),
    },
    body: data && JSON.stringify(data),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  if (path === "/auth/login") {
    cookie = response.headers.get("set-cookie").split(";")[0];
    csrf = result.csrf;
  }
  return result;
}
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const period = date.slice(0, 7);
const workspace = root + "?period=" + period;
await request(workspace, 401);
await request("/auth/login", 201, "POST", {
  username: "admin",
  password: "Local-only-visual-test-2026!",
});
const mongo = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
await mongo.connect();
const db = mongo.db("veca_qa");
const users = db.collection("users");
const admin = await users.findOne({ username: "admin" });
const ids = [new ObjectId(), new ObjectId()];
try {
  await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
  await request(workspace, 403);
  await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
  const now = new Date().toISOString();
  await db.collection("crm_leads").insertMany(
    ids.map((_id, index) => ({
      ...crmLeadDefaults,
      _id,
      name: "Obra laboral QA " + (index + 1),
      email: "labor@example.test",
      phone: "000000001",
      district: "Lima",
      idea: "Registro laboral QA.",
      requestType: "premium",
      stage: "execution",
      source: "manual",
      submissionId: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      contactedAt: now,
      completedAt: null,
      events: [],
    })),
  );
  const existing = await request(workspace);
  assert.equal(existing.regimes[0].code, "general");
  const employee = await request(root + "/employees", 201, "POST", {
    name: "Profesional en planilla QA",
    documentType: "DNI",
    documentNumber: "50000001",
    position: "Instalador",
    hireDate: period + "-01",
    salaryCents: 210000,
    pensionSystem: "onp",
    laborRegime: "general",
    healthSystem: "essalud",
    regimeReference: "",
    active: true,
  });
  assert.equal(employee.endDate, "");
  const run = await request(root + "/runs", 201, "POST", {
    period,
    minimumWageCents: 110000,
    lines: [
      {
        employeeId: employee.id,
        days: 30,
        taxableExtraCents: 0,
        nonTaxableCents: 0,
        afpDeductionCents: 0,
        employerContributionCents: 0,
        gratuityCents: 0,
        ctsCents: 0,
        vacationCents: 0,
        fifthCategoryCents: 0,
        otherDeductionCents: 0,
      },
    ],
  });
  const payrollSource = {
    kind: "payroll",
    id: run.id,
    employeeId: employee.id,
  };
  const rows = ids.map((id, index) => ({
    workId: String(id),
    basisPoints: index ? 2500 : 5000,
  }));
  const allocate = (
    source,
    sourceRevision,
    status,
    revision = 0,
    distribution = rows,
  ) =>
    request(root + "/allocation", status, "PUT", {
      source,
      sourceRevision,
      revision,
      rows: distribution,
    });
  const margin = async (i) => request(accounting + "/margin/" + ids[i]);
  await allocate(payrollSource, run.revision, 409);
  assert.equal((await margin(0)).costs, 0);
  const approved = await request(
    root + "/runs/" + run.id + "/status",
    201,
    "POST",
    {
      revision: run.revision,
      status: "approved",
    },
  );
  await allocate(payrollSource, run.revision, 409);
  const writes = await Promise.allSettled([
    allocate(payrollSource, approved.revision, 200),
    allocate(payrollSource, approved.revision, 200),
  ]);
  assert.equal(writes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(
    writes.find(({ status }) => status === "rejected").reason.message,
    /409/,
  );
  assert.equal((await margin(0)).labor.payroll, 114450);
  assert.equal((await margin(1)).labor.payroll, 57225);
  const paid = await request(
    root + "/runs/" + run.id + "/status",
    201,
    "POST",
    {
      revision: approved.revision,
      status: "paid",
      date,
      reference: "PLANILLA-QA",
    },
  );
  assert.equal(paid.status, "paid");
  const feeInput = {
    professionalRuc: "10123456789",
    professionalName: "Profesional externo QA",
    service: "Montaje de prueba",
    issueDate: date,
    grossCents: 201001,
    withholdingAgent: true,
    suspensionNumber: "",
    suspensionYear: null,
    paymentTerms: "cash",
    dueDate: "",
    series: "E001",
    number: "80",
    notes: "",
    registered: false,
  };
  const draft = await request(root + "/receipts", 201, "POST", feeInput);
  const feeSource = { kind: "fee", id: draft.id };
  await allocate(feeSource, draft.revision, 409);
  const receipt = await request(root + "/receipts/" + draft.id, 200, "PUT", {
    ...feeInput,
    registered: true,
    revision: draft.revision,
  });
  await allocate(feeSource, receipt.revision, 200);
  const partial = await request(
    root + "/receipts/" + draft.id + "/payments",
    201,
    "POST",
    {
      revision: receipt.revision,
      date,
      reference: "RHE-PAGO-QA",
      grossCents: 100000,
      withholdingAgent: true,
      suspensionNumber: "",
      suspensionYear: null,
    },
  );
  assert.equal(partial.paidCents, 92000);
  assert.equal(partial.balanceGrossCents, 101001);
  const report = await margin(0);
  assert.deepEqual(report.labor, {
    payroll: 114450,
    fees: 100501,
    available: true,
  });
  assert.equal(report.costs, 214951);
  const second = await request(root + "/receipts", 201, "POST", {
    ...feeInput,
    registered: true,
    number: "81",
    grossCents: 10000,
  });
  await allocate({ kind: "fee", id: second.id }, second.revision, 200);
  assert.equal((await margin(0)).costs, 219951);
  await request(root + "/receipts/" + second.id + "/void", 201, "POST", {
    revision: second.revision,
  });
  assert.equal((await margin(0)).costs, 214951);
  const ledger = await request(workspace);
  assert.equal(ledger.receipts.length, 2);
  assert.ok(ledger.receipts.every(({ direction }) => direction === "received"));
  assert.equal(ledger.allocations.length, 3);
  console.log(
    "PASS: permissions, provider writes, revisions, draft exclusion, cost split, withholding, partial payment, void and project margin.",
  );
} finally {
  await users.updateOne({ _id: admin._id }, { $set: { role: "admin" } });
  await mongo.close();
}
