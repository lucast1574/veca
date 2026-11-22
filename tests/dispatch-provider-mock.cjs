// Preload only in isolated QA. Requests to the fiscal service never leave this process.
if (process.env.NODE_ENV === "test" && process.env.VECA_GUIDE_QA_MOCK === "1") {
  const assert = require("node:assert/strict");
  const { randomUUID } = require("node:crypto");
  const fetch = globalThis.fetch;
  const url = "https://api.apisunat.net/api/v1/issuer";
  let id;
  const invoices = new Map();
  globalThis.fetch = async (input, options) => {
    if (typeof input !== "string" || !input.startsWith(url + "/"))
      return fetch(input, options);
    const path = input.slice(url.length);
    if (
      options.headers.Authorization === "Bearer asu_test_local_contract_mock"
    ) {
      if (path === "/issuers")
        return Response.json({
          data: [
            {
              ruc: "20000000001",
              livemode: false,
              active: true,
              isDefault: true,
            },
            {
              ruc: "20616656156",
              livemode: true,
              active: true,
              isDefault: false,
            },
          ],
        });
      if (path === "/documents" && options.method === "POST") {
        const idempotency = options.headers["Idempotency-Key"];
        assert.match(idempotency, /^veca-demo-invoice-v1-/);
        const payload = JSON.parse(options.body);
        assert.equal(payload.ruc, "20000000001");
        assert.equal(payload.items[0].includesTax, false);
        const document = invoices.get(idempotency) || {
          id: randomUUID(),
          type: "01",
          test: true,
          issuerRuc: payload.ruc,
          fullNumber: "F001-" + (invoices.size + 1),
          status: "accepted",
        };
        invoices.set(idempotency, document);
        return Response.json(document, { status: 202 });
      }
      const document = [...invoices.values()].find(
        (entry) => path === `/documents/${entry.id}`,
      );
      if (document && !options.method) return Response.json(document);
      if (
        [...invoices.values()].some(
          (entry) => path === `/documents/${entry.id}/pdf`,
        )
      )
        return new Response("%PDF-1.4 INVOICE QA", {
          headers: { "Content-Type": "application/pdf" },
        });
      throw new Error("Ruta beta inesperada en QA");
    }
    assert.equal(
      options.headers.Authorization,
      "Bearer asu_live_local_contract_mock",
    );
    if (path === "/issuers/20616656156" && !options.method)
      return Response.json({
        ruc: "20616656156",
        livemode: true,
        active: true,
        productionEnabled: true,
        credentials: {
          produccion: {
            configured: true,
            hasCertificate: true,
            certificateExpiresAt: "2099-01-01",
            validatedAt: "2026-11-01",
          },
        },
      });
    if (path === "/series?ruc=20616656156" && !options.method)
      return Response.json({
        data: [
          { documentType: "01", series: "F001", active: true },
          { documentType: "09", series: "T001", active: true },
        ],
      });
    if (path === "/documents" && options.method === "POST") {
      const attempt = options.headers["Idempotency-Key"];
      const payload = JSON.parse(options.body);
      assert.equal(payload.documentType, "01");
      assert.equal(payload.ruc, "20616656156");
      assert.equal(payload.items[0].includesTax, false);
      const issued = {
        id: randomUUID(),
        issuerRuc: payload.ruc,
        type: "01",
        test: false,
        status: "accepted",
        fullNumber: "F001-90",
        total: 118,
      };
      invoices.set(attempt, issued);
      return Response.json(issued, { status: 202 });
    }
    if (path === "/guides" && options.method === "POST") {
      assert.equal(id, undefined, "Se envió la guía más de una vez.");
      assert.match(options.headers["Idempotency-Key"], /^[\w-]{36}$/);
      const data = JSON.parse(options.body);
      assert.equal(data.ruc, "20616656156");
      assert.equal(data.weightKg, 420);
      assert.equal(data.customer.name, "Cliente de prueba");
      assert.equal(data.items[0].unitCode, "MTK");
      assert.equal(data.vehiclePlate, "ABC123");
      id = randomUUID();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Response.json(
        {
          id,
          type: "09",
          test: false,
          issuerRuc: data.ruc,
          fullNumber: "T001-17",
          status: "processing",
        },
        { status: 202 },
      );
    }
    if (id && path === `/guides/${id}`)
      return Response.json({
        id,
        type: "09",
        test: false,
        issuerRuc: "20616656156",
        fullNumber: "T001-17",
        status: "accepted",
      });
    if (id && path === `/documents/${id}/pdf`)
      return new Response("%PDF-1.4 QA", {
        headers: { "Content-Type": "application/pdf" },
      });
    throw new Error("Ruta fiscal inesperada en QA");
  };
}
