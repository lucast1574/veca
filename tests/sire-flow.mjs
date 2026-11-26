import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";

const base = process.env.QA_API_URL || "http://localhost:4400";
assert.equal(
  new URL(base).hostname,
  "localhost",
  "SIRE QA must use the isolated local API",
);
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const period = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
}).format(new Date());
const root = "/admin/accounting/period/";
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
  const session = await login.json();
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (
    path,
    method = "GET",
    authorized = true,
    csrf = true,
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: "http://localhost:3300",
        ...(authorized && { Cookie: cookie }),
        ...(csrf && { "X-Veca-Csrf": session.csrf }),
      },
    });
    return { status: r.status, data: await r.json() };
  };
  const startPath = (book) => `${root}${period}/reconcile/${book}/automatic`;
  const salesInbox = `/admin/accounting/sire/sales?month=${period}`;
  assert.equal((await request(salesInbox, "GET", false)).status, 401);
  assert.deepEqual((await request(salesInbox)).data, {
    items: [],
    hasMore: false,
  });
  assert.equal(
    (await request(startPath("purchases"), "POST", false)).status,
    401,
  );
  assert.equal(
    (await request(startPath("purchases"), "POST", true, false)).status,
    403,
  );
  assert.equal(
    (await request("/admin/accounting/sire/connection", "GET", false)).status,
    401,
  );
  const invoiceId = new ObjectId(),
    costId = new ObjectId();
  await db.collection("accounting_invoices").insertOne({
    _id: invoiceId,
    issueDate: period + "-05",
    status: "accepted",
    number: "FQA-0001",
    customerRuc: "20100066603",
    totalCents: 11800,
  });
  await db.collection("accounting_costs").insertOne({
    _id: costId,
    date: period + "-05",
    kind: "fuel",
    reference: "FQA-0001",
    supplierRuc: "20100066603",
    netCents: 10000,
    taxCents: 1800,
  });
  try {
    assert.equal(
      (await request("/admin/accounting/sire/connection")).data.configured,
      true,
    );
    for (const book of ["sales", "purchases"]) {
      const started = await request(startPath(book), "POST");
      assert.equal(started.status, 201);
      assert.equal(started.data.status, "pending");
      if (book === "sales") {
        const inbox = (await request(salesInbox)).data;
        assert.equal(inbox.syncing, true);
        assert.equal("job" in inbox, false);
        assert.equal(
          (await db.collection("sire_sales_syncs").findOne({ _id: period }))
            .job,
          started.data.job,
        );
      }
      const path = startPath(book) + "/" + started.data.job;
      assert.equal((await request(path, "GET", false)).status, 401);
      assert.equal((await request(path)).data.status, "pending");
      const ready = await request(path);
      assert.equal(ready.status, 200);
      assert.equal(ready.data.status, "ready");
      assert.equal(ready.data.result.matches, 1);
      assert.equal(
        ready.data.result.issues.find((row) => row.reference === "FQA-2")
          .status,
        "onlySunat",
      );
      assert.equal(
        "files" in ready.data,
        false,
        "TXT is processed on the server, not returned to the browser",
      );
      const other = path.replace(
        `/reconcile/${book}/`,
        `/reconcile/${book === "sales" ? "purchases" : "sales"}/`,
      );
      assert.equal((await request(other)).status, 400);
    }
    const syncedSales = (await request(salesInbox)).data;
    assert.ok(syncedSales.syncedAt);
    assert.equal(syncedSales.syncing, undefined);
    assert.deepEqual(
      syncedSales.items.map(({ reference, total }) => [reference, total]),
      [
        ["FQA-1", 11800],
        ["FQA-2", 11800],
      ],
    );
    assert.deepEqual((await request(salesInbox + "&page=2")).data.items, []);
    assert.deepEqual(
      (await request("/admin/accounting/sire/sales?month=2032-01")).data.items,
      [],
    );
    assert.equal(
      await db
        .collection("accounting_invoices")
        .countDocuments({ issueDate: period + "-05" }),
      1,
      "consulting SUNAT does not create invoices in VECA",
    );
    const fields = Array(27).fill("");
    Object.assign(fields, {
      0: "20616656156",
      2: period.replace("-", ""),
      6: "01",
      7: "FQA",
      8: "1",
      11: "20100066603",
      25: "118.00",
      26: "PEN",
    });
    const txt = new FormData();
    txt.append(
      "file",
      new Blob([fields.join("|")], { type: "text/plain" }),
      "propuesta-ventas.txt",
    );
    const manual = await fetch(base + root + period + "/reconcile/sales", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3300",
        Cookie: cookie,
        "X-Veca-Csrf": session.csrf,
      },
      body: txt,
    });
    assert.equal(manual.status, 201);
    assert.equal((await manual.json()).matches, 1);
    assert.deepEqual((await request(salesInbox)).data.items, syncedSales.items);
    const mismatchPath = root + "2026-01/reconcile/purchases/automatic";
    const mismatch = await request(mismatchPath, "POST");
    assert.equal(
      (await request(mismatchPath + "/" + mismatch.data.job)).status,
      400,
    );
    const emptyPath = root + "2026-04/reconcile/purchases/automatic";
    const empty = await request(emptyPath, "POST");
    await request(emptyPath + "/" + empty.data.job);
    const emptyResult = await request(emptyPath + "/" + empty.data.job);
    assert.equal(emptyResult.data.result.count, 0);
    const unavailable = await request(
      root + "2026-05/reconcile/purchases/automatic",
      "POST",
    );
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.data.message, /SUNAT no está disponible/);
    assert.equal(JSON.stringify(unavailable.data).includes("<html>"), false);
    const admin = await db.collection("users").findOne({ username: "admin" });
    try {
      await db
        .collection("users")
        .updateOne({ _id: admin._id }, { $set: { role: "operations" } });
      assert.equal((await request(startPath("sales"), "POST")).status, 403);
      assert.equal((await request(salesInbox)).status, 403);
      assert.equal(
        (await request("/admin/accounting/sire/connection")).status,
        403,
      );
    } finally {
      await db
        .collection("users")
        .updateOne({ _id: admin._id }, { $set: { role: admin.role } });
    }
    console.log(
      "PASS SIRE: conexión, compras/ventas automáticas, espera, comparación, libro/RUC, periodo vacío, caída del proveedor, sesión, CSRF y permisos.",
    );
  } finally {
    await db.collection("accounting_invoices").deleteOne({ _id: invoiceId });
    await db.collection("accounting_costs").deleteOne({ _id: costId });
    await db.collection("sire_sales_syncs").deleteOne({ _id: period });
  }
} finally {
  await client.close();
}
