import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";

const base = "http://localhost:4400";
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const invoiceIds = [],
  costIds = [];
const month = "2031-05";
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
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie };
  async function report(period = month) {
    const response = await fetch(`${base}/admin/accounting/period/${period}`, {
      headers,
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const before = await report();
  const invoice = (status, issueDate, createdAt, netCents = 10000) => {
    const _id = new ObjectId();
    invoiceIds.push(_id);
    return {
      _id,
      status,
      issueDate,
      createdAt,
      netCents,
      taxCents: 1800,
      totalCents: netCents + 1800,
      paidCents: 0,
    };
  };
  await db
    .collection("accounting_invoices")
    .insertMany([
      invoice("accepted", "2031-05-10", "2031-04-01T12:00:00.000Z"),
      invoice("observed", "2031-05-11", "2031-04-01T12:00:00.000Z"),
      invoice("draft", "", "2031-05-01T05:00:00.000Z"),
      invoice("requested", "", "2031-06-01T04:59:59.999Z"),
      invoice("pending", "2031-05-12", "2031-04-01T12:00:00.000Z"),
      invoice("sending", "2031-05-13", "2031-04-01T12:00:00.000Z"),
      invoice("rejected", "2031-05-14", "2031-04-01T12:00:00.000Z"),
      invoice("draft", "", "2031-05-01T04:59:59.999Z"),
      invoice("draft", "", "2031-06-01T05:00:00.000Z"),
      invoice("accepted", "2031-04-30", "2031-05-01T12:00:00.000Z"),
    ]);
  for (const [kind, reviewed, netCents, taxCents] of [
    ["fuel", false, 1000, 180],
    ["purchase", true, 2000, 360],
    ["materials", false, 9000, 0],
  ]) {
    const _id = new ObjectId();
    costIds.push(_id);
    await db.collection("accounting_costs").insertOne({
      _id,
      kind,
      reviewed,
      date: "2031-05-15",
      netCents,
      taxCents,
    });
  }
  const after = await report();
  assert.equal(after.salesCount - before.salesCount, 2);
  assert.equal(after.salesNet - before.salesNet, 20000);
  assert.equal(after.salesTax - before.salesTax, 3600);
  assert.equal(
    after.pendingInvoices.toIssue - before.pendingInvoices.toIssue,
    2,
  );
  assert.equal(
    after.pendingInvoices.toConfirm - before.pendingInvoices.toConfirm,
    2,
  );
  assert.equal(
    after.pendingInvoices.toCorrect - before.pendingInvoices.toCorrect,
    1,
  );
  assert.equal(after.costsCount - before.costsCount, 2);
  assert.equal(
    after.costsNet - before.costsNet,
    3000,
    "stock consumption does not duplicate the supplier purchase",
  );
  assert.equal(after.costsTax - before.costsTax, 540);
  assert.equal(after.pendingCosts - before.pendingCosts, 1);
  const csv = await (
    await fetch(`${base}/admin/accounting/period/${month}/sales.csv`, {
      headers,
    })
  ).text();
  assert.equal(
    csv.trim().split("\r\n").length,
    3,
    "the sales CSV includes the same two accepted sales",
  );
  const empty = await report("2032-01");
  assert.deepEqual(
    [empty.salesCount, empty.costsCount, empty.pendingCosts],
    [0, 0, 0],
  );
  assert.deepEqual(empty.pendingInvoices, {
    toIssue: 0,
    toConfirm: 0,
    toCorrect: 0,
  });
  const overviewResponse = await fetch(
    `${base}/admin/accounting/period/${month}/overview`,
    { headers },
  );
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.months.length, 6);
  assert.equal(overview.months[0].period, "2030-12");
  assert.equal(overview.months.at(-1).period, month);
  assert.equal(overview.months.at(-1).salesNet, after.salesNet);
  assert.equal(overview.months.at(-1).salesTax, after.salesTax);
  assert.equal(overview.months.at(-1).costsNet, after.costsNet);
  assert.equal(overview.months.at(-1).costsTax, after.costsTax);
  assert.equal(overview.months.at(-2).salesNet, 10000);
  assert.deepEqual(overview.costBreakdown, [
    { kind: "purchase", netCents: 2000 },
    { kind: "fuel", netCents: 1000 },
  ]);
  assert.equal(
    overview.costBreakdown.reduce((sum, row) => sum + row.netCents, 0),
    after.costsNet,
  );
  assert.equal(
    (await fetch(`${base}/admin/accounting/period/${month}/overview`)).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${base}/admin/accounting/period/2031-13/overview`, {
        headers,
      })
    ).status,
    400,
  );
  async function invoiceList(query = "") {
    const response = await fetch(`${base}/admin/accounting/invoices${query}`, {
      headers,
    });
    assert.equal(response.status, 200);
    return (await response.json()).items;
  }
  const monthly = await invoiceList(`?month=${month}`);
  assert.deepEqual(
    monthly.map((row) => row.id).sort(),
    invoiceIds.slice(0, 7).map(String).sort(),
  );
  assert.equal(
    monthly.filter((row) => ["accepted", "observed"].includes(row.status))
      .length,
    after.salesCount,
  );
  const allDates = await invoiceList();
  assert.ok(allDates.some((row) => row.id === String(invoiceIds[7])));
  assert.ok(allDates.some((row) => row.id === String(invoiceIds[8])));
  assert.ok(
    (await invoiceList("?queue=requested")).some(
      (row) => row.id === String(invoiceIds[3]),
    ),
  );
  assert.ok(
    (await invoiceList("?queue=collect")).some(
      (row) => row.id === String(invoiceIds[9]),
    ),
    "collection queue keeps accepted invoices from previous months",
  );
  const missingDate = invoice("draft", "", "2031-05-20T12:00:00.000Z");
  delete missingDate.issueDate;
  const nullDate = invoice("draft", null, "2031-05-20T12:00:00.000Z");
  await db
    .collection("accounting_invoices")
    .insertMany([missingDate, nullDate]);
  const legacy = await invoiceList(`?month=${month}`);
  assert.equal(legacy.length, 9);
  assert.equal(
    (await report()).pendingInvoices.toIssue,
    after.pendingInvoices.toIssue + 2,
  );
  assert.equal(
    (
      await fetch(`${base}/admin/accounting/invoices?month=invalid`, {
        headers,
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/admin/accounting/invoices?month=${month}`)).status,
    401,
  );
  console.log(
    "PASS tax period and invoice list: matching monthly scope, Lima boundaries, legacy undated drafts, unfiltered operational queues, accepted totals, purchase integrity, CSV and empty month.",
  );
} finally {
  await db
    .collection("accounting_invoices")
    .deleteMany({ _id: { $in: invoiceIds } });
  await db.collection("accounting_costs").deleteMany({ _id: { $in: costIds } });
  await client.close();
}
