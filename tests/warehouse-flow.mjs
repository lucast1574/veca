import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { crmLeadDefaults } from "../packages/content/dist/index.js";

const root = "/admin/warehouse";
const acct = "/admin/accounting";
const crm = "/admin/crm";
let cookie = "",
  csrf = "";
async function call(
  path,
  status = 200,
  data,
  method = data === undefined ? "GET" : "POST",
  attempt = 0,
) {
  const form = data instanceof FormData;
  const result = await fetch("http://localhost:4400" + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      Cookie: cookie,
      "X-Veca-Csrf": csrf,
      ...(data !== undefined && !form
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: form ? data : data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await result.json();
  if (path === acct + "/costs" && body.check?.status === "pending") {
    assert.ok(attempt < 8, "La comprobación de SUNAT debe terminar");
    await new Promise((resolve) => setTimeout(resolve, 100));
    return call(path, status, data, method, attempt + 1);
  }

  assert.equal(
    result.status,
    status,
    `${method} ${path} → ${JSON.stringify(body)}`,
  );
  if (path === "/auth/login") {
    cookie = result.headers.get("set-cookie").split(";")[0];
    csrf = body.csrf;
  }
  return body;
}

const now = new Date();
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);
const month = date.slice(0, 7);
const dbClient = new MongoClient("mongodb://127.0.0.1:27099", {
  serverSelectionTimeoutMS: 3000,
});
await dbClient.connect();
try {
  const db = dbClient.db("veca_qa");
  const users = db.collection("users");
  const admin = await users.findOne({ username: "admin" });
  const workId = new ObjectId();
  await db.collection("crm_leads").insertOne({
    ...crmLeadDefaults,
    _id: workId,
    name: "Obra logística QA",
    phone: "000000000",
    email: "warehouse@example.test",
    district: "Lima",
    idea: "Prueba de integración de compras y almacén.",
    requestType: "premium",
    stage: "execution",
    source: "manual",
    submissionId: randomUUID(),
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    events: [],
  });
  await call(root + "/equipment", 401);
  await call("/auth/login", 201, {
    username: "admin",
    password: "Local-only-visual-test-2026!",
  });
  try {
    const material = {
      sku: "AGL-QA-18",
      name: "Aglomerado QA 18 mm",
      category: "Aglomerado",
      unit: "unit",
      location: "A1",
      description: "Tablero aislado",
      minimum: 2,
    };
    const importing = root + "/materials/import";
    const dimensions = { baseMm: 2440, heightMm: 1830 };
    await call(importing, 400, { materials: [material, material] });
    await call(importing, 400, {
      materials: [{ ...material, dimensions: { baseMm: 2440 } }],
    });
    assert.deepEqual(
      await call(importing, 201, { materials: [{ ...material, dimensions }] }),
      {
        created: 1,
        updated: 0,
      },
    );
    const current = async () =>
      (await call(crm + "/materials?search=AGL-QA-18"))[0];
    const { id: materialId } = await current();
    const buying = root + "/purchases";
    const receivable = buying + "?status=pending_receipt&search=AGL-QA-18";
    const requested = await call(root + "/purchase-requests", 201, {
      id: new ObjectId().toHexString(),
      workId: String(workId),
      reason: "Panelería",
      materials: [{ materialId, quantity: 8 }],
    });
    assert.equal(requested.status, "requested");
    assert.ok(
      !(await call(receivable)).items.some((row) => row.id === requested.id),
    );
    await call(buying + "/" + requested.id + "/receive", 400, {
      operationId: randomUUID(),
      materialId,
      quantity: 1,
      reference: "Sin compra",
    });
    const order = await call(
      buying + "/" + requested.id + "/order",
      200,
      {
        id: requested.id,
        workId: String(workId),
        supplier: "Tableros QA",
        supplierRuc: "20100066603",
        reason: "Panelería",
        items: [
          {
            materialId,
            requested: 8,
            ordered: 10,
            unitCents: 1250,
            reason: "Dos piezas de reserva por corte.",
          },
        ],
      },
      "PUT",
    );
    assert.equal(order.status, "open");
    assert.equal(
      (await call(receivable)).items.find((row) => row.id === order.id)?.status,
      "open",
    );
    const receive = buying + "/" + order.id + "/receive";
    const first = {
      operationId: randomUUID(),
      materialId,
      quantity: 6,
    };
    const withoutDocument = await call(receive, 201, first);
    assert.equal(withoutDocument.status, "partial");
    assert.equal(
      (await call(receivable)).items.find((row) => row.id === order.id)?.status,
      "partial",
    );
    assert.equal(withoutDocument.receipts[0].reference, "");
    assert.equal((await call(receive, 201, first)).items[0].received, 6);
    assert.equal(
      (await call(receive, 201, { ...first, reference: "   " })).items[0]
        .received,
      6,
    );
    await call(receive, 409, { ...first, reference: "Otro documento" });
    await call(receive, 409, { ...first, quantity: 5 });
    await call(receive, 400, {
      ...first,
      operationId: randomUUID(),
      quantity: 5,
    });
    assert.equal(
      (
        await call(receive, 201, {
          ...first,
          operationId: randomUUID(),
          quantity: 4,
        })
      ).status,
      "received",
    );
    assert.ok(
      !(await call(receivable)).items.some((row) => row.id === order.id),
    );
    await call(buying + "/" + order.id + "/cancel", 409, {});
    assert.equal((await current()).balance, 10);
    assert.equal((await current()).unitCostCents, 1250);
    await call(importing, 400, { materials: [{ ...material, unit: "m" }] });
    assert.deepEqual(
      await call(importing, 201, {
        materials: [{ ...material, location: "A2" }],
      }),
      { created: 0, updated: 1 },
    );
    assert.equal((await current()).balance, 10);
    assert.deepEqual((await current()).dimensions, dimensions);
    const countPath = root + "/materials/" + materialId + "/count";
    const count = {
      operationId: randomUUID(),
      version: (await current()).version,
      counted: 9,
      reason: "Una unidad dañada.",
    };
    const counted = await call(countPath, 201, count);
    assert.equal(counted.previousBalance, 10);
    assert.equal(counted.balanceAfter, 9);
    assert.equal((await call(countPath, 201, count)).balanceAfter, 9);
    await call(countPath, 409, { ...count, operationId: randomUUID() });
    const equipment = root + "/equipment";
    const tool = await call(equipment, 201, {
      id: String(new ObjectId()),
      code: "EQU-QA-01",
      name: "Ventosa QA",
      location: "Almacén",
      condition: "good",
    });
    assert.ok((await call(equipment)).some((row) => row.id === tool.id));
    const toolPath = equipment + "/" + tool.id;
    const assign = await call(toolPath, 201, {
      action: "assign",
      version: tool.version,
      workId: String(workId),
      responsible: "Instalador QA",
      note: "",
    });
    assert.equal(assign.assignment.workId, String(workId));
    const repeatedAssignment = await call(toolPath, 201, {
      action: "assign",
      version: tool.version,
      workId: String(workId),
      responsible: "Instalador QA",
      note: "",
    });
    assert.equal(repeatedAssignment.version, assign.version);
    assert.equal(repeatedAssignment.events.length, 1);
    await call(toolPath, 409, {
      action: "assign",
      version: tool.version,
      workId: String(workId),
      responsible: "Otro instalador QA",
      note: "",
    });

    const planPath = root + "/works/" + workId;
    const plan = {
      revision: 0,
      budgetCents: 45_000,
      equipment: [tool.id],
      materials: [{ materialId, quantity: 8 }],
    };
    const supply = await call(planPath, 200, plan, "PUT");
    assert.equal(supply.materials[0].requested, 8);
    assert.equal(supply.materials[0].ordered, 10);
    assert.equal(supply.materials[0].received, 10);
    assert.equal(supply.equipment[0].assigned, true);
    await call(planPath, 409, plan, "PUT");

    const guideId = new ObjectId();
    await db.collection("dispatches").insertOne({
      _id: guideId,
      leadId: String(workId),
      workName: "Obra logística QA",
      demo: false,
      status: "accepted",
      version: 1,
      observation: "",
      guideNumber: "T001-100",
      data: {
        items: [
          {
            materialId,
            code: material.sku,
            unitCode: "NIU",
            quantity: 6,
            description: material.name,
          },
        ],
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      events: [],
    });
    const departure =
      crm + "/leads/" + workId + "/dispatches/" + guideId + "/depart";
    const departed = await call(departure, 201, {});
    assert.equal(
      (await call(departure, 201, {})).departedAt,
      departed.departedAt,
    );
    assert.equal((await current()).balance, 3);
    const movePath = crm + "/materials/" + materialId + "/movements";
    const used = await call(movePath, 201, {
      operationId: randomUUID(),
      kind: "consumption",
      quantity: 5,
      reason: "Instalación de paneles",
      leadId: String(workId),
    });
    assert.equal(used.balanceAfter, 3);
    assert.equal(used.costCents, 6250);
    const returned = await call(movePath, 201, {
      operationId: randomUUID(),
      kind: "return",
      quantity: 2,
      reason: "Retorno al almacén",
      leadId: String(workId),
    });
    assert.equal(returned.balanceAfter, 5);
    assert.equal(returned.costCents, -1250);
    const lastPlan = await call(planPath);
    assert.equal(lastPlan.materials[0].delivered, 6);
    assert.equal(lastPlan.materials[0].consumed, 5);
    assert.equal(lastPlan.materials[0].returned, 2);
    const back = await call(toolPath, 201, {
      action: "return",
      version: assign.version,
      location: "Taller",
      condition: "maintenance",
      note: "Revisar sello.",
    });
    assert.equal(back.assignment, null);
    assert.equal(back.events.length, 2);

    if (process.env.VECA_GUIDE_QA_MOCK === "1")
      assert.deepEqual(await call("/admin/administration/demo/connection"), {
        connected: true,
      });
    const expense = {
      kind: "purchase",
      description: "Pastilla QA",
      date,
      supplier: "Tableros QA",
      supplierRuc: "20100066603",
      reference: "F054-003",
      netCents: 12500,
      taxCents: 2250,
      purchaseId: order.id,
      allocations: [{ workId: String(workId), cents: 12500 }],
    };
    await call(acct + "/costs", 201, {
      id: String(new ObjectId()),
      data: expense,
    });
    const margin = await call(acct + "/margin/" + workId);
    assert.equal(margin.materialCosts, 5000);
    assert.equal(margin.costs, 5000);
    assert.equal(margin.budgetCents, 45000);
    assert.equal(margin.pendingValuation, false);
    assert.equal(
      margin.costBreakdown.find((row) => row.kind === "materials").cents,
      5000,
    );
    assert.equal(
      margin.costBreakdown.reduce((sum, row) => sum + row.cents, 0),
      margin.costs,
    );
    const cols = Array(40).fill("");
    Object.assign(cols, {
      0: "20616656156",
      2: month.replace("-", ""),
      6: "01",
      7: "F054",
      9: "3",
      12: "20100066603",
      24: "147.50",
      25: "PEN",
    });
    const second = [...cols];
    second[9] = "4";
    const file = new FormData();
    file.append(
      "file",
      new Blob([cols.join("|") + "|\n" + second.join("|") + "|\n"]),
      "rce-qa.txt",
    );
    const report = await call(
      acct + "/period/" + month + "/reconcile/purchases",
      201,
      file,
    );
    for (const content of ["", "RUC|Nombre|Periodo\n"]) {
      const emptyProposal = new FormData();
      emptyProposal.append("file", new Blob([content]), "rce-vacio.txt");
      await call(
        acct + "/period/" + month + "/reconcile/purchases",
        400,
        emptyProposal,
      );
    }
    assert.equal(report.matches, 1);
    assert.equal(
      report.issues.find((row) => row.reference === "F054-4").status,
      "onlySunat",
    );

    for (const [kind, cents, number] of [
      ["fuel", 2000, "991"],
      ["transport", 3000, "992"],
    ]) {
      await call(acct + "/costs", 201, {
        id: String(new ObjectId()),
        data: {
          ...expense,
          kind,
          reference: "FQA-" + number,
          netCents: cents,
          taxCents: Math.round(cents * 0.18),
          allocations: [{ workId: String(workId), cents }],
        },
      });
    }
    const categorized = await call(acct + "/margin/" + workId);
    assert.equal(categorized.costs, 10000);
    assert.equal(
      categorized.costBreakdown.find((row) => row.kind === "fuel").cents,
      2000,
    );
    assert.equal(
      categorized.costBreakdown.find((row) => row.kind === "transport").cents,
      3000,
    );
    assert.equal(
      categorized.costBreakdown.reduce((sum, row) => sum + row.cents, 0),
      categorized.costs,
    );

    const generalRequest = {
      id: String(new ObjectId()),
      workId: "",
      reason: "Reposición de almacén general",
      materials: [{ materialId, quantity: 3 }],
    };
    const general = await call(
      root + "/purchase-requests",
      201,
      generalRequest,
    );
    assert.equal(general.status, "requested");
    assert.equal(general.workId, "");
    assert.equal(general.workName, "");
    assert.equal(
      (await call(root + "/purchase-requests", 201, generalRequest)).id,
      general.id,
    );
    await call(root + "/purchase-requests", 409, {
      ...generalRequest,
      workId: String(workId),
    });
    const balanceBeforeReceipt = (await current()).balance;
    const generalOrder = await call(
      buying + "/" + general.id + "/order",
      200,
      {
        id: general.id,
        workId: "",
        supplier: "Tableros QA",
        supplierRuc: "20100066603",
        reason: general.reason,
        items: [
          {
            materialId,
            requested: 3,
            ordered: 3,
            unitCents: 1250,
            reason: general.reason,
          },
        ],
      },
      "PUT",
    );
    assert.equal(generalOrder.status, "open");
    const generalReceipt = await call(
      buying + "/" + general.id + "/receive",
      201,
      {
        operationId: randomUUID(),
        materialId,
        quantity: 3,
      },
    );
    assert.equal(generalReceipt.status, "received");
    assert.equal(generalReceipt.workId, "");
    assert.equal((await current()).balance, balanceBeforeReceipt + 3);

    await users.updateOne({ _id: admin._id }, { $set: { role: "accounting" } });
    await call(root + "/equipment", 403);
    assert.ok(
      (await call(acct + "/cost-origins")).purchases.some(
        (row) => row.value === order.id,
      ),
    );
    await users.updateOne({ _id: admin._id }, { $set: { role: "operations" } });
    await call(acct + "/cost-origins", 403);
    await call(root + "/equipment");
    console.log(
      "Compras, importación, conteo, equipos, obra, despacho, valoración y conciliación probados.",
    );
  } finally {
    await users.updateOne({ _id: admin._id }, { $set: { role: admin.role } });
  }
} finally {
  await dbClient.close();
}
