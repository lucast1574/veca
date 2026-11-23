const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const employees = new Map();
const runs = new Map();
const receipts = new Map();
const regimes = [
  {
    code: "general",
    label: "Régimen general privado",
    guidance: "Verifica el régimen del trabajador.",
    requiresReference: false,
    defaultHealthSystem: "essalud",
    healthSystems: ["essalud", "eps"],
  },
];
const issuedId = randomUUID();

module.exports = (path, options) => {
  assert.equal(options.headers["X-API-Key"], "asu_live_local_contract_mock");
  const [collection, id, operation] = path.split("/");
  const method = options.method;
  if (method === "GET" && collection === "regimes")
    return Response.json(regimes);
  const stores = { employees, runs, receipts };
  const store = stores[collection];
  assert.ok(store, path);
  if (method === "GET") {
    const values = [...store.values()];
    if (collection === "receipts" && values.length)
      values.push({ ...values[0], id: issuedId, direction: "issued" });
    return Response.json(values);
  }
  const input = JSON.parse(options.body);
  const current = store.get(id);
  if (id && current?.revision !== input.revision)
    return Response.json(
      { error: { message: "El registro cambió." } },
      { status: 409 },
    );
  const key = id || randomUUID();
  const revision = current ? current.revision + 1 : 0;
  let saved;
  if (collection === "employees") {
    saved = { ...input, endDate: input.endDate || "", id: key, revision };
  } else if (collection === "runs" && !operation) {
    const lines = input.lines.map((line) => {
      const employee = employees.get(line.employeeId);
      assert.ok(employee);
      const grossCents = Math.round((employee.salaryCents * line.days) / 30);
      return {
        ...line,
        employeeName: employee.name,
        grossCents,
        netCents: Math.round(grossCents * 0.87),
        employerEssaludCents: Math.round(
          Math.max(grossCents, input.minimumWageCents) * 0.09,
        ),
      };
    });
    const total = (field) => lines.reduce((sum, line) => sum + line[field], 0);
    saved = {
      ...input,
      id: key,
      revision,
      lines,
      status: "draft",
      paidAt: null,
      paymentReference: "",
      grossCents: total("grossCents"),
      netCents: total("netCents"),
      deductionCents: total("grossCents") - total("netCents"),
      employerEssaludCents: total("employerEssaludCents"),
    };
  } else if (collection === "runs" && operation === "status") {
    saved = {
      ...current,
      revision,
      status: input.status,
      ...(input.status === "paid" && {
        paidAt: input.date,
        paymentReference: input.reference,
      }),
    };
  } else if (collection === "receipts" && !operation) {
    assert.equal(input.direction, "received");
    assert.equal(input.customerDocumentNumber, "20616656156");
    const withholdingCents =
      input.withholdingAgent && input.grossCents > 150000
        ? Math.round(input.grossCents * 0.08)
        : 0;
    saved = {
      ...input,
      id: key,
      revision,
      status: input.registered ? "registered" : "draft",
      withholdingCents,
      netCents: input.grossCents - withholdingCents,
      paidCents: 0,
      paidGrossCents: 0,
      withheldPaidCents: 0,
      balanceGrossCents: input.grossCents,
      payments: [],
    };
  } else if (collection === "receipts" && operation === "payments") {
    assert.equal(current.status, "registered");
    const withholdingCents =
      input.withholdingAgent && current.grossCents > 150000
        ? Math.round(input.grossCents * 0.08)
        : 0;
    const payment = {
      ...input,
      id: randomUUID(),
      withholdingCents,
      amountCents: input.grossCents - withholdingCents,
    };
    saved = {
      ...current,
      revision,
      payments: [...current.payments, payment],
      paidCents: current.paidCents + payment.amountCents,
      paidGrossCents: current.paidGrossCents + input.grossCents,
      withheldPaidCents: current.withheldPaidCents + withholdingCents,
      balanceGrossCents: current.balanceGrossCents - input.grossCents,
    };
  } else if (collection === "receipts" && operation === "void") {
    saved = { ...current, revision, status: "void" };
  } else {
    throw new Error("Ruta laboral inesperada en QA");
  }
  store.set(key, saved);
  return Response.json(saved, { status: method === "POST" ? 201 : 200 });
};
