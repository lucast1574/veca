// Preload only in isolated QA. Requests to the fiscal service never leave this process.
if (process.env.NODE_ENV === "test" && process.env.VECA_GUIDE_QA_MOCK === "1") {
  const assert = require("node:assert/strict");
  const { randomUUID } = require("node:crypto");
  const payroll = require("./labor-provider-mock.cjs");
  const fetch = globalThis.fetch;
  const url = "https://api.apisunat.net/api/v1/issuer";
  const guides = new Map();
  const guideAttempts = new Map();
  const destinations = new Set();
  const issuerEnabled = process.env.VECA_GUIDE_QA_ISSUER_DISABLED !== "1";
  const invoices = new Map();
  const demoInvoices = new Map();
  globalThis.fetch = async (input, options) => {
    if (typeof input !== "string" || !input.startsWith(url + "/"))
      return fetch(input, options);
    const path = input.slice(url.length);
    const laborPrefix = "/issuers/20616656156/payroll/";
    if (path.startsWith(laborPrefix))
      return payroll(path.slice(laborPrefix.length), options);
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
        const document = demoInvoices.get(idempotency) || {
          id: randomUUID(),
          type: "01",
          test: true,
          issuerRuc: payload.ruc,
          fullNumber: "F001-" + (demoInvoices.size + 1),
          status: "accepted",
        };
        demoInvoices.set(idempotency, document);
        return Response.json(document, { status: 202 });
      }
      const document = [...demoInvoices.values()].find(
        (entry) => path === `/documents/${entry.id}`,
      );
      if (document && !options.method) return Response.json(document);
      if (
        [...demoInvoices.values()].some(
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
        productionEnabled: issuerEnabled,
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
      const previous = invoices.get(attempt);
      if (previous) {
        assert.equal(options.body, previous.body);
        return Response.json(previous.document, { status: 202 });
      }
      assert.equal(payload.documentType, "01");
      assert.equal(payload.ruc, "20616656156");
      assert.equal(payload.items[0].includesTax, false);
      const issued = {
        id: randomUUID(),
        issuerRuc: payload.ruc,
        type: "01",
        test: false,
        status:
          payload.customer.name === "Cliente QA observado"
            ? "accepted_with_observations"
            : payload.customer.name === "Cliente QA rechazado"
              ? "rejected"
              : payload.customer.name === "Cliente QA pendiente"
                ? "processing"
                : "accepted",
        fullNumber: "F001-" + (90 + invoices.size),
        total: 118,
      };
      if (issued.status === "accepted_with_observations")
        issued.sunat = {
          description: "Verifica la dirección fiscal del cliente.",
        };
      if (issued.status === "rejected")
        issued.sunat = {
          errorMessage: "El RUC del receptor no es válido.",
          fix: { message: "Corrige el RUC en los datos del cliente." },
        };
      invoices.set(attempt, { document: issued, body: options.body });
      if (payload.customer.name === "Cliente QA respuesta perdida") {
        assert.equal(
          [...invoices.values()].filter(({ body }) => body === options.body)
            .length,
          1,
        );
        throw new Error("Respuesta perdida después de emitir");
      }
      return Response.json(issued, { status: 202 });
    }
    const invoice = [...invoices.values()].find(
      ({ document }) => path === `/documents/${document.id}`,
    )?.document;
    if (invoice && !options.method)
      return Response.json({
        ...invoice,
        status: invoice.status === "processing" ? "accepted" : invoice.status,
      });
    const attachment =
      /^\/documents\/([^/]+)\/(pdf|xml|cdr)(\?delivery=direct)?$/.exec(path);
    if (
      attachment &&
      [...invoices.values()].some(
        ({ document }) => document.id === attachment[1],
      )
    ) {
      if (attachment[2] !== "pdf" && !attachment[3]) {
        assert.equal(options.redirect, "error");
        throw new TypeError("Unexpected redirect to the signed artifact URL");
      }
      return new Response(
        {
          pdf: "%PDF-1.4 DEMO",
          xml: "<Invoice/>",
          cdr: "PK DEMO CDR",
        }[attachment[2]],
      );
    }
    if (path === "/guides" && options.method === "POST") {
      assert.ok(
        issuerEnabled,
        "Se intentó emitir con el emisor deshabilitado.",
      );
      const key = options.headers["Idempotency-Key"];
      assert.match(key, /^[\w-]{36}$/);
      const previous = guideAttempts.get(key);
      if (previous) {
        assert.equal(options.body, previous.body);
        return Response.json(previous.guide, { status: 202 });
      }
      const data = JSON.parse(options.body);
      assert.equal(data.ruc, "20616656156");
      assert.equal(data.weightKg, 420);
      assert.equal(data.customer.name, "Cliente de prueba");
      assert.equal(data.items[0].unitCode, "MTK");
      if (data.arrivalAddress === "Obra de prueba desde Contabilidad") {
        assert.deepEqual(data.items[1], {
          code: "DIM-GUIA-QA",
          description: "Paño de vidrio · 1200 × 850 mm",
          quantity: 3,
          unitCode: "NIU",
        });
      }
      assert.equal(data.vehiclePlate, "ABC123");
      if (data.arrivalAddress === "Obra QA sin credenciales GRE")
        return Response.json(
          { error: { code: "GUIDE_CREDENTIALS_REQUIRED" } },
          { status: 409 },
        );
      assert.ok(
        !destinations.has(data.arrivalAddress),
        "Se envió la guía más de una vez.",
      );
      destinations.add(data.arrivalAddress);
      const guide = {
        id: randomUUID(),
        type: "09",
        test: false,
        issuerRuc: data.ruc,
        fullNumber: "T001-" + (17 + guides.size),
        status: "processing",
      };
      guides.set(guide.id, guide);
      guideAttempts.set(key, { guide, body: options.body });
      if (data.arrivalAddress === "Obra QA respuesta perdida")
        throw new Error("Respuesta perdida después de emitir");
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Response.json(guide, { status: 202 });
    }
    const id = path.split("/")[2];
    if (guides.has(id) && path === `/guides/${id}`)
      return Response.json({ ...guides.get(id), status: "accepted" });
    if (guides.has(id) && path === `/documents/${id}/pdf`)
      return new Response("%PDF-1.4 QA", {
        headers: { "Content-Type": "application/pdf" },
      });
    throw new Error("Ruta fiscal inesperada en QA");
  };
}
