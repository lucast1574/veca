import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse, delay } from "msw";
import { within, userEvent, expect, waitFor } from "storybook/test";
import { AccountingCosts } from "../../src/features/accounting/AccountingCosts";
import { AccountingAccess } from "../../src/features/accounting/AccountingAccess";
import { WorkspaceShell } from "../../src/components/workspace/WorkspaceShell";
import { user, works } from "./fixtures";
import { warehouseHandlers } from "./warehouse-fixtures";
import type { SirePurchase } from "@veca/content";
const meta = {
  title: "VECA/Compras de proveedores",
  parameters: { layout: "fullscreen" },
  beforeEach() {
    rows = sample.map((row) => ({ ...row }));
    availablePurchases = existingPurchases;
    refreshCase = "none";
    refreshed = false;
    syncCalls = 0;
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const sample: SirePurchase[] = [
  {
    id: "111111111111111111111111",
    version: 1,
    period: "2026-11",
    reference: "F001-1208",
    taxId: "20100000001",
    supplier: "Estación de servicio · Ejemplo",
    date: "2026-11-20",
    type: "01",
    total: 7500,
    net: 6356,
    tax: 1144,
    currency: "PEN",
    importable: true,
    status: "pending",
  },
  {
    id: "222222222222222222222222",
    version: 1,
    period: "2026-11",
    reference: "F001-1208",
    taxId: "20100000002",
    supplier: "Cristales del Pacífico · Ejemplo",
    date: "2026-11-25",
    type: "01",
    total: 665520,
    net: 564000,
    tax: 101520,
    currency: "PEN",
    importable: true,
    status: "pending",
  },
  {
    id: "333333333333333333333333",
    version: 1,
    period: "2026-11",
    reference: "F001-98",
    taxId: "20100000003",
    supplier: "Transporte local · Ejemplo",
    date: "2026-11-18",
    type: "01",
    total: 1000,
    net: 847,
    tax: 153,
    currency: "PEN",
    importable: true,
    status: "pending",
  },
];
let rows = sample.map((row) => ({ ...row }));
const existingPurchases = [
  {
    id: "444444444444444444444444",
    label: "Materiales para ventanas · Compra de ejemplo",
    referenceMatch: false,
  },
];
let availablePurchases = existingPurchases;
const baseline = "2026-11-25T13:40:00.000Z";
const afterRefresh = "2026-11-25T13:41:00.000Z";
let refreshCase: "new" | "none" | "error" = "none";
let refreshed = false;
let syncCalls = 0;
const comparison = {
  book: "purchases",
  period: "2026-11",
  count: 3,
  matches: 2,
  issues: [
    {
      status: "onlySunat",
      reference: "F001-98",
      taxId: "20100000003",
      sunat: 1000,
      currency: "PEN",
    },
  ],
};
const handlers = [
  http.get("*/admin/accounting/sire/connection", () =>
    HttpResponse.json({ configured: true }),
  ),
  http.post(
    "*/admin/accounting/period/:month/reconcile/purchases/automatic",
    async () => {
      syncCalls++;
      await delay(400);
      if (refreshCase === "error") {
        refreshCase = "none";
        return HttpResponse.json(
          { message: "No pudimos consultar SUNAT. Tus compras se conservan." },
          { status: 503 },
        );
      }
      return HttpResponse.json(
        { job: "v1.storybook", status: "pending" },
        { status: 201 },
      );
    },
  ),
  http.get(
    "*/admin/accounting/period/:month/reconcile/purchases/automatic/:job",
    () => {
      if (!refreshed && refreshCase === "new")
        rows = [
          { ...sample[2], firstSeenAt: "2026-11-25T13:40:30.000Z" },
          ...rows,
        ];
      refreshed = true;
      return HttpResponse.json({
        job: "v1.storybook",
        status: "ready",
        result: comparison,
      });
    },
  ),
  http.post("*/admin/accounting/costs", () =>
    HttpResponse.json(
      {
        check: { status: "found", purchaseId: sample[0].id, period: "2026-11" },
      },
      { status: 201 },
    ),
  ),
  http.get("*/admin/accounting/cost-origins", () =>
    HttpResponse.json({ purchases: [], dispatches: [] }),
  ),
  http.get("*/admin/accounting/costs", () =>
    HttpResponse.json({ items: [], hasMore: false }),
  ),
  http.get("*/admin/accounting/works", () =>
    HttpResponse.json(works.map((w) => ({ id: w.id, name: w.workName }))),
  ),
  http.get("*/admin/accounting/sire/purchases", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const all = params.get("state") === "all";
    const since = params.get("newSince");
    const pending = rows.filter((row) => row.status === "pending");
    return HttpResponse.json({
      items: all ? rows : pending,
      total: rows.length,
      pending: pending.length,
      pendingCents: pending.reduce((sum, r) => sum + r.total, 0),
      registered: rows.length - pending.length,
      review: 0,
      hasMore: false,
      syncedAt: refreshed ? afterRefresh : baseline,
      checkedAt: refreshed ? afterRefresh : baseline,
      newCount: rows.filter(
        (row) => since && row.firstSeenAt && row.firstSeenAt > since,
      ).length,
    });
  }),
  http.get("*/admin/accounting/sire/purchases/:id", ({ params }) =>
    HttpResponse.json({
      item: rows.find((row) => row.id === params.id),
      purchases: availablePurchases,
    }),
  ),
  http.post(
    "*/admin/accounting/sire/purchases/:id/incorporate",
    ({ params }) => {
      rows = rows.map((row) =>
        row.id === params.id ? { ...row, status: "registered" } : row,
      );
      return HttpResponse.json({ costId: params.id }, { status: 201 });
    },
  ),
  ...warehouseHandlers,
];
const render = () => (
  <WorkspaceShell
    user={user}
    view="accounting"
    projectCount={12}
    onNavigate={() => false}
  >
    <div className="storybook-demo">
      Vista de ejemplo · Proveedores y facturas ficticias
    </div>
    <main className="ops-page accounting-workspace">
      <AccountingAccess.Provider value={["accounting_write"]}>
        <AccountingCosts inventoryAccess />
      </AccountingAccess.Provider>
    </main>
    <div id="workspace-overlays" />
  </WorkspaceShell>
);
export const ComprasPendientes: Story = {
  name: "Bandeja de compras por registrar",
  beforeEach() {
    rows = sample.map((row) => ({ ...row }));
    availablePurchases = existingPurchases;
    refreshCase = "none";
    refreshed = false;
    syncCalls = 0;
  },
  parameters: { msw: handlers },
  render,
};
export const ActualizarConNuevasCompras: Story = {
  ...ComprasPendientes,
  name: "Actualizar: compras nuevas y foco en la primera",
  beforeEach() {
    rows = sample.slice(0, 2).map((row) => ({ ...row }));
    refreshCase = "new";
    refreshed = false;
    syncCalls = 0;
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const update = await page.findByRole("button", {
      name: "Actualizar compras",
    });
    await waitFor(() => expect(update).toBeEnabled());
    await userEvent.click(update);
    await expect(
      page.getByRole("button", { name: "Actualizando…" }),
    ).toBeDisabled();
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(
      await page.findByText(
        /Encontramos 1 compra nueva/,
        {},
        { timeout: 10000 },
      ),
    ).toBeVisible();
    await expect(page.getByText("Nueva")).toBeVisible();
    await waitFor(() =>
      expect(
        page.getAllByRole("button", { name: /Completar compra/ })[0],
      ).toHaveFocus(),
    );
    await expect(syncCalls).toBe(1);
  },
};
export const ActualizarSinNovedades: Story = {
  ...ComprasPendientes,
  name: "Actualizar: sin compras nuevas",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const update = await page.findByRole("button", {
      name: "Actualizar compras",
    });
    await waitFor(() => expect(update).toBeEnabled());
    await userEvent.click(update);
    await expect(
      await page.findByText(/Tu bandeja está al día/, {}, { timeout: 10000 }),
    ).toBeVisible();
    await waitFor(() => expect(update).toHaveFocus());
    await expect(page.queryByText("Nueva")).not.toBeInTheDocument();
  },
};
export const ActualizarConReintento: Story = {
  ...ComprasPendientes,
  name: "Actualizar: error y reintento",
  beforeEach() {
    rows = sample.map((row) => ({ ...row }));
    refreshCase = "error";
    refreshed = false;
    syncCalls = 0;
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const update = await page.findByRole("button", {
      name: "Actualizar compras",
    });
    await waitFor(() => expect(update).toBeEnabled());
    await userEvent.click(update);
    await expect(await page.findByRole("alert")).toHaveTextContent(
      /Tus compras se conservan/,
    );
    await expect(
      within(
        page.getByRole("region", { name: "Compras por registrar" }),
      ).getAllByRole("button", { name: /Completar compra/ }),
    ).toHaveLength(3);
    await userEvent.click(update);
    await expect(
      await page.findByText(/Tu bandeja está al día/, {}, { timeout: 10000 }),
    ).toBeVisible();
  },
};
export const CompararCompras: Story = {
  ...ComprasPendientes,
  name: "Comparar: acción separada y resultados",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Comparar con SUNAT" }),
    );
    await expect(
      await page.findByRole("dialog", { name: "Comparar compras con SUNAT" }),
    ).toBeVisible();
    const compare = await page.findByRole("button", {
      name: "Comparar compras",
    });
    await waitFor(() => expect(compare).toBeEnabled());
    await userEvent.click(compare);
    await expect(
      await page.findByRole(
        "dialog",
        { name: "Comparación de compras · 2026-11" },
        { timeout: 10000 },
      ),
    ).toBeVisible();
    await expect(page.getByText("2 coinciden · 1 por revisar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Descargar diferencias" }),
    ).toBeEnabled();
  },
};
export const CompletarCompra: Story = {
  ...ComprasPendientes,
  name: "Modal para completar compra",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      (await canvas.findAllByRole("button", { name: /Completar compra/ }))[0],
    );
  },
};
export const ComprasGuardadas: Story = {
  ...ComprasPendientes,
  name: "Todas las compras guardadas",
  beforeEach() {
    rows = sample.map((row) => ({ ...row, status: "registered" }));
    availablePurchases = existingPurchases;
  },
};

async function openMaterials(canvasElement: HTMLElement) {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    (await page.findAllByRole("button", { name: /^Completar compra$/ }))[1],
  );
  await userEvent.type(
    await page.findByRole("textbox", { name: "¿Para qué fue esta compra?" }),
    "Paños de vidrio para la fachada del piso 4",
  );
  await userEvent.click(
    page.getByRole("combobox", { name: "Destino de la compra" }),
  );
  await userEvent.click(
    await page.findByRole("option", {
      name: "Compra de materiales para almacén",
    }),
  );
  return page;
}
export const MaterialesSinPedido: Story = {
  ...ComprasPendientes,
  name: "Materiales: continuar sin un selector innecesario",
  beforeEach() {
    rows = sample.map((row) => ({ ...row }));
    availablePurchases = [];
  },
  play: async ({ canvasElement }) => {
    const page = await openMaterials(canvasElement);
    await expect(
      page.queryByRole("combobox", { name: "Detalle de materiales" }),
    ).not.toBeInTheDocument();
    await expect(
      page.getByRole("button", { name: "Guardar y completar materiales" }),
    ).toBeEnabled();
  },
};
export const VincularPedidoExistente: Story = {
  ...ComprasPendientes,
  name: "Materiales: vincular un pedido ya registrado",
  play: async ({ canvasElement }) => {
    const page = await openMaterials(canvasElement);
    await expect(
      page.getByRole("button", { name: "Guardar y completar materiales" }),
    ).toBeEnabled();
    await userEvent.click(
      page.getByRole("combobox", { name: "Detalle de materiales" }),
    );
    await userEvent.click(
      await page.findByRole("option", { name: existingPurchases[0].label }),
    );
    await expect(
      page.getByRole("button", { name: "Guardar y vincular pedido" }),
    ).toBeEnabled();
  },
};

export const FacturaManualYaEncontrada: Story = {
  ...ComprasPendientes,
  name: "Registro manual: continuar con factura de SUNAT",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Registrar gasto o compra" }),
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /^Concepto$/ }),
      "Cena comercial de ejemplo",
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /^RUC del proveedor$/ }),
      sample[0].taxId,
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /^Número de comprobante$/ }),
      sample[0].reference,
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /^Importe sin IGV$/ }),
      "63.56",
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /^IGV del comprobante$/ }),
      "11.44",
    );
    await userEvent.click(
      page.getByRole("button", { name: /^Guardar registro$/ }),
    );
    await expect(
      page.findByRole("heading", { name: "Encontramos esta factura en SUNAT" }),
    ).resolves.toBeVisible();
  },
};
