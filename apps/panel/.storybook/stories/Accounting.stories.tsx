import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type {
  AccountingPeriod,
  AccountingTrends,
  AccountingInvoice,
  CostInput,
} from "@veca/content";
import { AccountingWorkspace } from "../../src/features/accounting/AccountingWorkspace";
import { StoryFrame } from "./StoryFrame";
import { user } from "./fixtures";

const report: AccountingPeriod = {
  salesNet: 2000000,
  salesTax: 360000,
  salesCount: 3,
  costsNet: 800000,
  costsTax: 144000,
  costsCount: 8,
  pendingCosts: 2,
  pendingInvoices: { toIssue: 2, toConfirm: 1, toCorrect: 1 },
  sirePurchases: {
    pending: 3,
    review: 0,
    syncedAt: "2026-11-25T14:00:00Z",
    syncFailed: false,
    syncing: false,
  },
};
const categories: AccountingTrends["costBreakdown"] = [
  { kind: "purchase", netCents: 480000 },
  { kind: "services", netCents: 180000 },
  { kind: "fuel", netCents: 60000 },
  { kind: "transport", netCents: 40000 },
  { kind: "meals", netCents: 40000 },
];
const invoices: AccountingInvoice[] = (
  [
    "accepted",
    "accepted",
    "observed",
    "requested",
    "draft",
    "pending",
    "rejected",
  ] as const
).map((status, i) => {
  const net = [1000000, 600000, 400000, 0, 250000, 180000, 95000][i];
  return {
    id: String(i + 30).padStart(24, "0"),
    version: 1,
    customer: [
      "Edificio Alameda · Ejemplo",
      "Oficinas Mirador · Ejemplo",
      "Residencia Los Olivos · Ejemplo",
    ][i % 3],
    customerRuc: "20100000001",
    workId: "",
    workName: "Venta de ejemplo",
    status,
    createdAt: "2026-11-20T14:00:00Z",
    issueDate: status === "draft" || status === "requested" ? "" : "2026-11-20",
    number: status === "draft" || status === "requested" ? "" : `F001-${i + 1}`,
    observation:
      status === "observed"
        ? "Ejemplo: revisa la dirección fiscal del cliente para tus próximas emisiones."
        : status === "rejected"
          ? "Ejemplo: el RUC del cliente no es válido. Verifica los 11 dígitos en Editar factura."
          : "",
    canCheck: status === "pending",
    method: "credit",
    dueDate: "2026-12-15",
    netCents: net,
    taxCents: net * 0.18,
    totalCents: net * 1.18,
    paidCents: 0,
    payments: [],
    items: [],
  };
});
let failReport = false;
let fiscalPath = "";
let lastInvoiceMonth: string | null | undefined;
const zero: AccountingPeriod = {
  salesNet: 0,
  salesTax: 0,
  salesCount: 0,
  costsNet: 0,
  costsTax: 0,
  costsCount: 0,
  pendingCosts: 0,
  pendingInvoices: { toIssue: 0, toConfirm: 0, toCorrect: 0 },
  sirePurchases: { pending: 0, review: 0, syncedAt: "2026-11-25T14:00:00Z" },
};
const comparison = {
  book: "sales",
  period: "2026-11",
  count: 3,
  matches: 2,
  issues: [
    {
      status: "different",
      reference: "F001-3",
      taxId: "20100000001",
      sunat: 477000,
      panel: 472000,
      currency: "PEN",
    },
  ],
};
const mocks = [
  http.get("*/account/notifications", () =>
    HttpResponse.json({ items: [], unread: 0 }),
  ),
  http.get("*/account/notifications/config", () =>
    HttpResponse.json({ configured: false }),
  ),
  http.get("*/account/notifications/events", () =>
    HttpResponse.json({ items: [] }),
  ),
  http.get("*/admin/accounting/period/:month/overview", ({ params }) => {
    const empty = params.month === "2032-01";
    const anchor = new Date(`${params.month}-01T12:00:00Z`);
    return HttpResponse.json({
      months: Array.from({ length: 6 }, (_, i) => {
        const date = new Date(anchor);
        date.setUTCMonth(date.getUTCMonth() - 5 + i);
        const salesNet = empty
          ? 0
          : [850000, 1200000, 1100000, 1600000, 1750000, 2000000][i];
        const costsNet = empty
          ? 0
          : [540000, 710000, 660000, 900000, 950000, 800000][i];
        return {
          period: date.toISOString().slice(0, 7),
          salesNet,
          salesTax: salesNet * 0.18,
          costsNet,
          costsTax: costsNet * 0.18,
        };
      }),
      costBreakdown: empty ? [] : categories,
    } satisfies AccountingTrends);
  }),
  http.get("*/admin/accounting/period/:month", ({ params }) => {
    if (failReport) {
      failReport = false;
      return HttpResponse.json(
        { message: "No pudimos cargar el resumen del periodo." },
        { status: 503 },
      );
    }
    return HttpResponse.json(params.month === "2032-01" ? zero : report);
  }),
  http.get("*/admin/accounting/sire/sales", () =>
    HttpResponse.json({
      items: [
        {
          reference: "F001-1250",
          taxId: "20100000005",
          total: 354000,
          currency: "PEN",
          type: "01",
        },
      ],
      hasMore: false,
      syncedAt: "2026-11-25T14:00:00Z",
    }),
  ),
  http.get("*/admin/accounting/invoices/:id", ({ params }) =>
    HttpResponse.json({
      invoice: invoices.find((row) => row.id === params.id),
      enabled: true,
    }),
  ),
  http.get("*/admin/accounting/works", () => HttpResponse.json([])),
  http.get("*/admin/accounting/invoices", ({ request }) => {
    const params = new URL(request.url).searchParams;
    lastInvoiceMonth = params.get("month");
    const queue = params.get("queue");
    const filtered = invoices.filter((row) =>
      queue === "requested"
        ? row.status === "requested"
        : queue === "collect"
          ? ["accepted", "observed"].includes(row.status) &&
            row.paidCents < row.totalCents
          : true,
    );
    return HttpResponse.json({
      items: filtered.map((row) => ({
        ...row,
        ...(lastInvoiceMonth && {
          createdAt: `${lastInvoiceMonth}-20T14:00:00Z`,
          issueDate: row.issueDate ? `${lastInvoiceMonth}-20` : "",
        }),
      })),
      hasMore: false,
      enabled: true,
    });
  }),
  http.get("*/admin/accounting/costs", ({ request }) => {
    const month = new URL(request.url).searchParams.get("month") || "2026-11";
    const lines: [CostInput["kind"], number][] = [
      ["purchase", 240000],
      ["purchase", 240000],
      ["services", 90000],
      ["services", 90000],
      ["fuel", 30000],
      ["fuel", 30000],
      ["transport", 40000],
      ["meals", 40000],
    ];
    return HttpResponse.json({
      items: lines.map(([kind, netCents], i) => ({
        id: String(i + 50).padStart(24, "0"),
        version: 1,
        kind,
        description: `Compra ${i + 1} · Ejemplo`,
        date: `${month}-20`,
        netCents,
        taxCents: netCents * 0.18,
        reviewed: i < 6,
        proof: true,
      })),
      hasMore: false,
    });
  }),
  http.get("*/admin/accounting/purchase-orders", () =>
    HttpResponse.json({ items: [], hasMore: false }),
  ),
  http.get("*/admin/accounting/sire/purchases", ({ request }) => {
    const month = new URL(request.url).searchParams.get("month") || "2026-11";
    return HttpResponse.json({
      items: [
        "Cristales del Pacífico",
        "Transporte local",
        "Estación de servicio",
      ].map((supplier, i) => ({
        id: String(i + 70).padStart(24, "0"),
        version: 1,
        period: month,
        reference: `F001-${i + 100}`,
        supplier: `${supplier} · Ejemplo`,
        taxId: "20100000001",
        date: `${month}-20`,
        type: "01",
        net: 10000,
        tax: 1800,
        total: 11800,
        currency: "PEN",
        importable: true,
        status: "pending",
      })),
      total: 3,
      pending: 3,
      pendingCents: 35400,
      registered: 0,
      review: 0,
      hasMore: false,
      syncedAt: "2026-11-25T14:00:00Z",
      checkedAt: "2026-11-25T14:01:00Z",
    });
  }),
  http.get("*/admin/accounting/sire/connection", () =>
    HttpResponse.json({ configured: true }),
  ),
  http.post(
    "*/admin/accounting/period/:month/reconcile/:book/automatic",
    async ({ params }) => {
      fiscalPath = String(params.book);
      await delay(200);
      return HttpResponse.json(
        { job: "v1.sales-example", status: "pending" },
        { status: 201 },
      );
    },
  ),
  http.get(
    "*/admin/accounting/period/:month/reconcile/:book/automatic/:job",
    ({ params }) =>
      HttpResponse.json({
        job: "v1.sales-example",
        status: "ready",
        result: { ...comparison, period: params.month, book: params.book },
      }),
  ),
];
const meta = {
  title: "VECA/Contabilidad por secciones",
  parameters: { layout: "fullscreen", msw: mocks },
  beforeEach() {
    failReport = false;
    fiscalPath = "";
    lastInvoiceMonth = undefined;
    history.replaceState(null, "", "#accounting/impuestos");
  },
  render: () => (
    <StoryFrame view="accounting">
      <AccountingWorkspace user={user} inventoryAccess />
    </StoryFrame>
  ),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ImpuestosConGraficos: Story = {
  name: "Impuestos: importes, pendientes y gráficos",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByText(/de SUNAT por completar en VECA/),
    ).toBeVisible();
    await expect(
      await page.findByRole("heading", { name: "Ventas y compras por mes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "¿En qué se compró o gastó?" }),
    ).toBeVisible();
    await expect(
      page.queryByRole("button", { name: "Comparar con SUNAT" }),
    ).not.toBeInTheDocument();
    await expect(
      page.getByRole("link", { name: "Ver ventas y facturas" }),
    ).toHaveAttribute("href", "#accounting/facturas?month=2026-11");
  },
};
export const IrACompras: Story = {
  name: "Impuestos: abrir compras conservando el mes",
  beforeEach() {
    history.replaceState(null, "", "#accounting/impuestos?month=2026-10");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("link", { name: "Ver compras y gastos" }),
    );
    await expect(await page.findByLabelText("Filtrar por periodo")).toHaveValue(
      "2026-10",
    );
    await expect(
      page.getAllByRole("region", { name: "Compras por registrar" }),
    ).toHaveLength(1);
    await expect(
      await page.findByText("Registro mensual de compras en SUNAT"),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Ver pasos para presentar" }),
    );
    await expect(
      await page.findByRole("dialog", { name: "Presentar compras · 2026-10" }),
    ).toBeVisible();
    await expect(
      await page.findByText(
        "3 compras por completar · 0 comprobantes con datos por revisar.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/2 compras guardadas sin sustento/),
    ).toBeVisible();
  },
};
export const IrAVentas: Story = {
  name: "Impuestos: abrir ventas conservando el mes",
  beforeEach() {
    history.replaceState(null, "", "#accounting/impuestos?month=2026-10");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("link", { name: "Ver ventas y facturas" }),
    );
    await expect(await page.findByLabelText("Periodo de ventas")).toHaveValue(
      "2026-10",
    );
    await expect(
      page.getByRole("combobox", { name: "Ver facturas" }),
    ).toHaveTextContent("Todas");
    await expect(
      page.queryByRole("link", { name: "Revisión con SUNAT" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(lastInvoiceMonth).toBe("2026-10"));
    await expect(
      page.getByText("Presentar el registro de ventas del mes"),
    ).toBeVisible();
  },
};
export const FacturasYVentas: Story = {
  name: "Todas: resumen compacto y facturas del periodo",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas");
  },
};
export const RevisionVentas: Story = {
  name: "Todas: diferencias en modal y regreso al listado",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByText("3 facturas aceptadas")).toBeVisible();
    const trigger = page.getByRole("button", { name: "Comparar con SUNAT" });
    await userEvent.click(trigger);
    const compare = await page.findByRole("button", {
      name: "Comparar ventas",
    });
    await waitFor(() => expect(compare).toBeEnabled());
    await userEvent.click(compare);
    await expect(
      await page.findByText(
        "2 coinciden · 1 por revisar",
        {},
        { timeout: 10000 },
      ),
    ).toBeVisible();
    await expect(fiscalPath).toBe("sales");
    await expect(page.getByText("Importe distinto")).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Comparación de ventas · 2026-11" }),
    ).toBeVisible();
    await expect(
      within(
        page.getByRole("region", { name: "Ventas del periodo" }),
      ).queryByText("Importe distinto"),
    ).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(
      page.getByRole("heading", { name: "Facturas en VECA" }),
    ).toBeVisible();
  },
};
export const ActualizarVentas: Story = {
  name: "Todas: actualizar resumen y listado juntos",
  beforeEach({ msw }) {
    history.replaceState(null, "", "#accounting/facturas");
    let reads = 0;
    let invoiceReads = 0;
    msw.use(
      http.get("*/admin/accounting/invoices", async () => {
        invoiceReads++;
        if (invoiceReads > 1) await delay(600);
        return HttpResponse.json({
          items:
            invoiceReads > 1
              ? [
                  ...invoices,
                  {
                    ...invoices[0],
                    id: "888888888888888888888888",
                    customer: "Cliente actualizado · Ejemplo",
                    netCents: 100000,
                    taxCents: 18000,
                    totalCents: 118000,
                    number: "F001-8",
                  },
                ]
              : invoices,
          hasMore: false,
          enabled: true,
        });
      }),
      http.get("*/admin/accounting/period/:month", async () => {
        reads++;
        if (reads > 1) await delay(500);
        return HttpResponse.json(
          reads > 1
            ? { ...report, salesCount: 4, salesNet: 2100000, salesTax: 378000 }
            : report,
        );
      }),
    );
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const update = await page.findByRole("button", {
      name: "Actualizar ventas",
    });
    await userEvent.click(update);
    await expect(
      page.getByRole("button", { name: "Actualizando…" }),
    ).toBeDisabled();
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(await page.findByText("4 facturas aceptadas")).toBeVisible();
    await expect(
      await page.findByText("Cliente actualizado · Ejemplo"),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        page.getByRole("button", { name: "Actualizar ventas" }),
      ).toBeEnabled(),
    );
    await expect(fiscalPath).toBe("");
  },
};
export const VentasArchivoManual: Story = {
  name: "Ventas: archivo manual siempre del RVIE",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Comparar con SUNAT" }),
    );
    await userEvent.click(
      await page.findByRole("button", { name: /Ya tengo un archivo TXT/ }),
    );
    await expect(
      await page.findByRole("dialog", { name: "Comparar archivo de SUNAT" }),
    ).toBeVisible();
    await expect(
      page.queryByRole("combobox", { name: "Registro" }),
    ).not.toBeInTheDocument();
    await userEvent.click(page.getByText("Qué archivo necesitas"));
    await expect(
      page.getByText(/Descarga la propuesta del Registro de ventas e ingresos/),
    ).toBeVisible();
  },
};
export const ImpuestosSinMovimientos: Story = {
  name: "Impuestos: mes sin movimientos",
  beforeEach() {
    history.replaceState(null, "", "#accounting/impuestos?month=2032-01");
  },
};
export const ImpuestosConError: Story = {
  name: "Impuestos: error y recuperación sin ceros falsos",
  beforeEach() {
    failReport = true;
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "No pudimos cargar el resumen del periodo.",
    );
    await expect(
      page.queryByText("0 registros guardados"),
    ).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Reintentar" }));
    await expect(await page.findByText("8 registros guardados")).toBeVisible();
  },
};

export const EnlaceAnteriorVentas: Story = {
  name: "Enlace anterior de SUNAT abre Todas",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas/sunat?month=2026-10");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByRole("heading", { name: "Facturas en VECA" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Ver facturas" }),
    ).toHaveTextContent("Todas");
    await expect(page.getByLabelText("Periodo de ventas")).toHaveValue(
      "2026-10",
    );
    await expect(
      page.queryByRole("link", { name: "Revisión con SUNAT" }),
    ).not.toBeInTheDocument();
  },
};
export const SolicitadasSinFiltroMensual: Story = {
  name: "Solicitadas: pendientes de cualquier mes",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas/solicitadas");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByText("Solicitada", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabelText("Periodo de ventas")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Ventas en SUNAT" }),
    ).toBeVisible();
    await expect(lastInvoiceMonth).toBe(null);
  },
};
export const PorCobrarSinFiltroMensual: Story = {
  name: "Por cobrar: saldos de cualquier mes",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas/por-cobrar");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findAllByText("Saldo por cobrar")).toHaveLength(3);
    await expect(
      page.getByRole("region", { name: "Ventas en SUNAT" }),
    ).toBeVisible();
    await expect(lastInvoiceMonth).toBe(null);
  },
};
export const NuevaFacturaDesdeTodas: Story = {
  name: "Todas: nueva factura conserva su modal",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas?month=2026-10");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Nueva factura" }),
    );
    await expect(
      await page.findByRole("dialog", { name: "Nueva factura" }),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(await page.findByLabelText("Periodo de ventas")).toHaveValue(
      "2026-10",
    );
  },
};

export const DetalleFacturaFiltrada: Story = {
  name: "Facturas: detalle en modal y filtro por cobrar",
  beforeEach() {
    history.replaceState(null, "", "#accounting/facturas?month=2026-11");
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const sunat = await page.findByRole("region", { name: "Ventas en SUNAT" });
    await userEvent.click(
      await within(sunat).findByRole("button", { name: "Ver detalle" }),
    );
    await expect(
      await page.findByRole("dialog", { name: "F001-1250" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    const filter = page.getByRole("combobox", { name: "Ver facturas" });
    await userEvent.click(filter);
    await userEvent.click(
      await page.findByRole("option", { name: "Por cobrar" }),
    );
    const list = page.getByRole("region", { name: "Facturas en VECA" });
    const detail = (
      await within(list).findAllByRole("button", { name: "Ver detalle" })
    )[0];
    await waitFor(() => expect(lastInvoiceMonth).toBeNull());
    await userEvent.click(detail);
    const modal = await page.findByRole("dialog", {
      name: "Edificio Alameda · Ejemplo",
    });
    await expect(
      within(modal).getByRole("button", { name: "Registrar cobro" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(filter).toHaveTextContent("Por cobrar");
    await waitFor(() => expect(detail).toHaveFocus());
  },
};
