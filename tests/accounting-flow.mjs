import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import sharp from "sharp";
import { crmLeadDefaults } from "../packages/content/dist/index.js";

const root = "/admin/accounting";
let cookie, csrf;
async function request(path, status = 200, method = "GET", data) {
  const form = data instanceof FormData;
  const response = await fetch("http://localhost:4400" + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(cookie ? { Cookie: cookie, "X-Veca-Csrf": csrf } : {}),
      ...(data && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? (form ? data : JSON.stringify(data)) : undefined,
  });
  const content = response.headers.get("content-type") || "";
  const result = content.includes("json")
    ? await response.json()
    : await response.text();
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
const requestId = () => randomBytes(12).toString("hex");

await request(root + "/invoices", 401);
await request("/auth/login", 201, "POST", {
  username: "admin",
  password: "Local-only-visual-test-2026!",
});
const mongo = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
await mongo.connect();
try {
  const db = mongo.db("veca_qa");
  const users = db.collection("users");
  const admin = await users.findOne({ username: "admin" });
  try {
    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    await request(root + "/costs", 403);
    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    const now = new Date().toISOString();
    const ids = [new ObjectId(), new ObjectId()];
    await db.collection("crm_leads").insertMany(
      ids.map((_id, i) => ({
        _id,
        ...crmLeadDefaults,
        name: "Obra contable aislada " + (i + 1),
        email: i + "@example.test",
        phone: "000000001",
        district: "Lima",
        idea: "Registro QA de contabilidad.",
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
    assert.ok(
      (await request(root + "/works")).some(
        (work) => work.id === ids[0].toHexString(),
      ),
    );
    const pedido = `/admin/crm/leads/${ids[1]}/invoice-request`;
    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    assert.deepEqual(await request(pedido, 201, "POST", {}), {
      requested: true,
    });
    assert.deepEqual(await request(pedido, 201, "POST", {}), {
      requested: true,
    });
    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    const queue = await request(root + "/invoices");
    const workRequests = queue.items.filter(
      (invoice) =>
        invoice.workId === String(ids[1]) && invoice.status === "requested",
    );
    assert.equal(workRequests.length, 1);
    if (process.env.VECA_GUIDE_QA_MOCK === "1")
      await request(
        `${root}/invoices/${workRequests[0].id}/issue`,
        400,
        "POST",
        { version: workRequests[0].version },
      );
    const creation = {
      id: requestId(),
      data: {
        workId: String(ids[0]),
        customer: "Cliente QA",
        customerRuc: "20100066603",
        method: "cash",
        items: [
          { description: "Instalación", quantityMilli: 1000, unitCents: 10000 },
        ],
      },
    };
    const periodPath = root + "/period/" + date.slice(0, 7);
    const beforeDraft = await request(periodPath);
    const invoice = await request(root + "/invoices", 201, "POST", creation);
    assert.equal(invoice.totalCents, 11800);
    const withDraft = await request(periodPath);
    assert.equal(
      withDraft.salesNet,
      beforeDraft.salesNet,
      "a draft is not an accepted sale",
    );
    assert.equal(
      withDraft.pendingInvoices.toIssue,
      beforeDraft.pendingInvoices.toIssue + 1,
    );
    assert.equal(
      (await request(root + "/invoices", 201, "POST", creation)).id,
      invoice.id,
    );
    const path = `${root}/invoices/${invoice.id}`;
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#e74927" },
    })
      .png()
      .toBuffer();
    const invoiceProof = new FormData();
    invoiceProof.append(
      "file",
      new Blob([photo], { type: "image/png" }),
      "sustento.png",
    );
    const supported = await request(path + "/proof", 201, "POST", invoiceProof);
    assert.equal(supported.proof, true);
    assert.equal(supported.version, invoice.version);
    assert.ok(!("proofKey" in supported));
    assert.match(await request(path + "/proof"), /^RIFF....WEBP/s);
    await request(path + "/proof", 409, "POST", invoiceProof);
    const privateResponse = await fetch(
      "http://localhost:4400" + path + "/proof",
    );
    assert.equal(privateResponse.status, 401);
    await request(path + "/payment", 409, "POST", {
      version: 1,
      date,
      cents: 100,
    });
    let paid = 0;
    if (process.env.VECA_GUIDE_QA_MOCK === "1") {
      const issued = await request(path + "/issue", 201, "POST", {
        version: invoice.version,
      });
      assert.equal(issued.status, "accepted");
      assert.match(await request(path + "/file/pdf"), /^%PDF/);
      assert.match(await request(path + "/file/xml"), /<Invoice\/>/);
      assert.match(await request(path + "/file/cdr"), /^PK/);
      const acceptedPeriod = await request(periodPath);
      assert.equal(acceptedPeriod.salesCount, beforeDraft.salesCount + 1);
      assert.equal(acceptedPeriod.salesNet, beforeDraft.salesNet + 10000);
      assert.equal(acceptedPeriod.salesTax, beforeDraft.salesTax + 1800);
      assert.equal(
        acceptedPeriod.pendingInvoices.toIssue,
        beforeDraft.pendingInvoices.toIssue,
      );
      await request(path + "/issue", 409, "POST", { version: invoice.version });
      for (const invalidDate of ["2099-01-01", "2000-01-01"]) {
        await request(path + "/payment", 400, "POST", {
          version: issued.version,
          date: invalidDate,
          cents: 100,
        });
      }
      const collected = await request(path + "/payment", 201, "POST", {
        version: issued.version,
        date,
        cents: 3200,
      });
      paid = collected.paidCents;
      assert.equal(paid, 3200);
      await request(path + "/payment", 400, "POST", {
        version: collected.version,
        date,
        cents: 8601,
      });
    }

    const gasoline = {
      id: requestId(),
      data: {
        kind: "fuel",
        description: "=SUM(1,2)",
        date,
        netCents: 2500,
        taxCents: 450,
        allocations: [
          { workId: String(ids[0]), cents: 1500 },
          { workId: String(ids[1]), cents: 1000 },
        ],
      },
    };
    const cost = await request(root + "/costs", 201, "POST", gasoline);
    const retried = await request(root + "/costs", 201, "POST", gasoline);
    assert.equal(retried.id, cost.id);
    const withCost = await request(periodPath);
    assert.equal(withCost.costsNet, beforeDraft.costsNet + 2500);
    assert.equal(withCost.costsTax, beforeDraft.costsTax + 450);
    assert.equal(withCost.costsCount, beforeDraft.costsCount + 1);
    assert.equal(withCost.pendingCosts, beforeDraft.pendingCosts + 1);
    const costInbox = async () =>
      (await request("/admin/dashboard/inbox")).find(
        (section) => section.key === "proofs",
      );
    const pendingInbox = await costInbox();
    assert.ok(pendingInbox.items.some((item) => item.id === cost.id));
    await request(root + "/costs", 409, "POST", {
      ...gasoline,
      data: { ...gasoline.data, taxCents: 465 },
    });
    const costPath = `${root}/costs/${cost.id}`;
    const edited = await request(costPath, 200, "PUT", {
      version: cost.version,
      data: { ...gasoline.data, reference: "F001-201" },
    });
    assert.equal(edited.reference, "F001-201");
    const proof = costPath + "/proof";
    await request(`${root}/costs/${cost.id}/review`, 400, "POST", {
      version: edited.version,
    });
    const form = new FormData();
    form.append(
      "file",
      new Blob(["%PDF-1.4 QA"], { type: "application/pdf" }),
      "qa.pdf",
    );
    const attached = await request(proof, 201, "POST", form);
    assert.equal(attached.proof, true);
    assert.equal(attached.reviewed, false);
    assert.match(await request(proof), /^%PDF/);
    const afterProof = await request(periodPath);
    assert.equal(afterProof.pendingCosts, beforeDraft.pendingCosts);
    assert.equal(afterProof.costsNet, withCost.costsNet);
    const attachedInbox = await costInbox();
    assert.equal(attachedInbox.count, pendingInbox.count - 1);
    assert.ok(!attachedInbox.items.some((item) => item.id === cost.id));
    const updated = await request(costPath, 200, "PUT", {
      version: attached.version,
      data: { ...gasoline.data, reference: "F001-201" },
    });
    assert.equal(updated.proof, true);
    const reviewed = await request(
      `${root}/costs/${cost.id}/review`,
      201,
      "POST",
      { version: updated.version },
    );
    assert.equal(reviewed.reviewed, true);
    const afterReview = await request(periodPath);
    assert.equal(afterReview.pendingCosts, beforeDraft.pendingCosts);
    assert.equal(
      afterReview.costsNet,
      withCost.costsNet,
      "reviewing does not count the purchase again",
    );
    await request(costPath, 409, "PUT", {
      version: reviewed.version,
      data: gasoline.data,
    });
    const margin = await request(root + "/margin/" + ids[0]);
    assert.equal(margin.costs, 1500);
    assert.equal(margin.paid, paid);
    const period = await request(root + "/period/" + date.slice(0, 7));
    assert.equal(period.costsTax, 450);
    const csv = await request(
      root + "/period/" + date.slice(0, 7) + "/costs.csv",
    );
    assert.ok(csv.includes('"\'=SUM(1,2)"'));
    assert.ok(csv.includes("Con sustento"));
    if (process.env.VECA_GUIDE_QA_MOCK === "1") {
      const partial = await request(root + "/invoices", 201, "POST", {
        id: requestId(),
        data: {
          ...creation.data,
          customer: "Cliente QA observado",
          customerRuc: "",
          items: [],
        },
      });
      assert.equal(partial.status, "draft");
      assert.equal(partial.totalCents, 0);
      const partialPath = `${root}/invoices/${partial.id}`;
      await request(partialPath + "/issue", 400, "POST", {
        version: partial.version,
      });
      const completed = await request(partialPath, 200, "PUT", {
        version: partial.version,
        data: { ...creation.data, customer: partial.customer },
      });
      const observed = await request(partialPath + "/issue", 201, "POST", {
        version: completed.version,
      });
      assert.equal(observed.status, "observed");
      assert.match(observed.observation, /dirección fiscal/);
      await db
        .collection("accounting_invoices")
        .updateOne(
          { _id: new ObjectId(observed.id) },
          { $set: { observation: "" } },
        );
      assert.equal(
        (await request(partialPath)).invoice.observation,
        observed.observation,
      );

      const retry = await request(root + "/invoices", 201, "POST", {
        id: requestId(),
        data: { ...creation.data, customer: "Cliente QA rechazado" },
      });
      const rejected = await request(
        `${root}/invoices/${retry.id}/issue`,
        201,
        "POST",
        { version: retry.version },
      );
      assert.equal(rejected.status, "rejected");
      assert.match(rejected.observation, /RUC del receptor no es válido/);
      assert.match(rejected.observation, /Corrige el RUC/);

      const requested = workRequests[0];
      await db.collection("accounting_invoices").updateOne(
        { _id: new ObjectId(requested.id) },
        {
          $set: {
            customerRuc: creation.data.customerRuc,
            items: creation.data.items,
            netCents: invoice.netCents,
            taxCents: invoice.taxCents,
            totalCents: invoice.totalCents,
          },
        },
      );
      const requestedPath = `${root}/invoices/${requested.id}/issue`;
      const issuedRequest = await request(requestedPath, 201, "POST", {
        version: requested.version,
      });
      assert.equal(issuedRequest.status, "accepted");
      await request(requestedPath, 409, "POST", { version: requested.version });

      const waiting = await request(root + "/invoices", 201, "POST", {
        id: requestId(),
        data: { ...creation.data, customer: "Cliente QA pendiente" },
      });
      const waitingPath = `${root}/invoices/${waiting.id}`;
      const pending = await request(waitingPath + "/issue", 201, "POST", {
        version: waiting.version,
      });
      assert.equal(pending.status, "pending");
      assert.equal(pending.canCheck, true);
      const confirmed = await request(waitingPath + "/check", 201, "POST", {
        version: pending.version,
      });
      assert.equal(confirmed.status, "accepted");
      assert.equal(confirmed.canCheck, false);

      const beforeFullPayment = (await request(path)).invoice;
      const fullPayment = await request(path + "/payment", 201, "POST", {
        version: beforeFullPayment.version,
        date,
        cents: beforeFullPayment.totalCents - beforeFullPayment.paidCents,
      });
      assert.equal(fullPayment.paidCents, fullPayment.totalCents);
      const receivables = await request(root + "/invoices?queue=collect");
      assert.ok(!receivables.items.some((row) => row.id === invoice.id));
    }
  } finally {
    await users.updateOne({ _id: admin._id }, { $set: { role: admin.role } });
  }
  console.log(
    "Contabilidad: permisos, borradores, emisión simulada, cobros, sustentos, reparto, margen y CSV.",
  );
} finally {
  await mongo.close();
}
