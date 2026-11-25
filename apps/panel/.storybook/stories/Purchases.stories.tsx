import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, userEvent, expect } from "storybook/test";
import { AccountingCosts } from "../../src/features/accounting/AccountingCosts";
import { AccountingAccess } from "../../src/features/accounting/AccountingAccess";
import { WorkspaceShell } from "../../src/components/workspace/WorkspaceShell";
import { user, works } from "./fixtures";
import { warehouseHandlers } from "./warehouse-fixtures";
import type { SirePurchase } from "@veca/content";
const meta = {
  title: "VECA/Compras de proveedores",
  parameters: { layout: "fullscreen" },
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
    reference: "F002-354",
    taxId: "20100000002",
    supplier: "Distribuidora de materiales · Ejemplo",
    date: "2026-11-19",
    type: "01",
    total: 4050,
    net: 3432,
    tax: 618,
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
const handlers = [
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
    const all = new URL(request.url).searchParams.get("state") === "all";
    const pending = rows.filter((row) => row.status === "pending");
    return HttpResponse.json({
      items: all ? rows : pending,
      total: rows.length,
      pending: pending.length,
      pendingCents: pending.reduce((sum, r) => sum + r.total, 0),
      registered: rows.length - pending.length,
      review: 0,
      hasMore: false,
      syncedAt: "2026-11-25T13:40:00Z",
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
  },
  parameters: { msw: handlers },
  render,
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
    "Materiales para ventanas",
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
