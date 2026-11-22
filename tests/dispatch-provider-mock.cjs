// Preload only in isolated QA. Requests to the fiscal service never leave this process.
if (process.env.NODE_ENV === "test" && process.env.VECA_GUIDE_QA_MOCK === "1") {
  const assert = require("node:assert/strict");
  const { randomUUID } = require("node:crypto");
  const fetch = globalThis.fetch;
  const url = "https://api.apisunat.net/api/v1/issuer";
  let id;
  globalThis.fetch = async (input, options) => {
    if (typeof input !== "string" || !input.startsWith(url + "/"))
      return fetch(input, options);
    assert.equal(
      options.headers.Authorization,
      "Bearer asu_live_local_contract_mock",
    );
    const path = input.slice(url.length);
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
