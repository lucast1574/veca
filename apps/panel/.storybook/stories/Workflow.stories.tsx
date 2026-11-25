import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { WorksWorkspace } from "../../src/features/works/WorksWorkspace";
import { AccountingWorkspace } from "../../src/features/accounting/AccountingWorkspace";
import { AccountingAccess } from "../../src/features/accounting/AccountingAccess";
import { SireSalesReview } from "../../src/features/accounting/SireSalesReview";
import type { AccountingMargin } from "@veca/content";
import { margin, user, works } from "./fixtures";
import { StoryFrame as Frame } from "./StoryFrame";
import { warehouseHandlers } from "./warehouse-fixtures";
import { expect, userEvent, within } from "storybook/test";
const meta = { title: "VECA/Flujos de trabajo" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const workScreen = () => (
  <Frame view="works">
    <WorksWorkspace
      user={user}
      canEdit
      inventoryAccess
      dispatchAccess
      accountingAccess
    />
  </Frame>
);
export const ObrasConActividad: Story = {
  name: "Obras con actividad",
  beforeEach() {
    history.replaceState(null, "", "#works");
  },
  render: workScreen,
};
export const ConciliacionSunat: Story = {
  name: "Ventas y comparación con SUNAT",
  render: () => (
    <Frame view="accounting">
      <AccountingAccess.Provider value={["accounting_write"]}>
        <SireSalesReview month="2026-11" />
      </AccountingAccess.Provider>
    </Frame>
  ),
};
export const ObraConPendientes: Story = {
  name: "Obra con pendientes",
  beforeEach() {
    history.replaceState(null, "", `#works/${works[0].id}/tasks`);
  },
  render: workScreen,
};
const marginScreen = () => (
  <Frame view="accounting">
    <AccountingWorkspace user={user} inventoryAccess />
  </Frame>
);
const selectMargin: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(
    await canvas.findByRole("combobox", { name: "Obra para consultar" }),
  );
  await userEvent.click(
    await canvas.findByRole("option", { name: works[0].workName }),
  );
  await expect(
    canvas.findByRole("heading", { name: works[0].workName }),
  ).resolves.toBeVisible();
};
export const MargenCompleto: Story = {
  name: "Margen con costos completos",
  beforeEach() {
    history.replaceState(null, "", "#accounting/margen");
  },
  render: marginScreen,
  play: selectMargin,
};
export const MargenPorRevisar: Story = {
  name: "Margen con costos pendientes",
  beforeEach({ msw }) {
    history.replaceState(null, "", "#accounting/margen");
    msw.use(
      http.get(
        "http://veca-storybook.invalid/admin/accounting/margin/:id",
        () =>
          HttpResponse.json({
            ...margin,
            costs: 9_300_000,
            costBreakdown: margin.costBreakdown.filter(
              (row) => row.kind !== "payroll" && row.kind !== "fees",
            ),
            labor: { available: false, payroll: 0, fees: 0 },
            pendingValuation: true,
            manualMaterialsToReview: 35_000,
          }),
      ),
    );
  },
  render: marginScreen,
  play: selectMargin,
};

const marginScenario =
  (patch: Partial<AccountingMargin>): Story["beforeEach"] =>
  ({ msw }) => {
    history.replaceState(null, "", "#accounting/margen");
    msw.use(
      http.get(
        "http://veca-storybook.invalid/admin/accounting/margin/:id",
        () => HttpResponse.json({ ...margin, ...patch }),
      ),
    );
  };
export const MargenConPerdida: Story = {
  name: "Margen con pérdida y sobrecosto",
  beforeEach: marginScenario({
    sales: 9_000_000,
    paid: 6_000_000,
    balance: 4_620_000,
    budgetCents: 12_000_000,
  }),
  render: marginScreen,
  play: selectMargin,
};
export const MargenSinMovimientos: Story = {
  name: "Margen sin movimientos",
  beforeEach: marginScenario({
    sales: 0,
    costs: 0,
    materialCosts: 0,
    costBreakdown: [],
    labor: { available: true, payroll: 0, fees: 0 },
    paid: 0,
    balance: 0,
    budgetCents: 0,
    costCount: 0,
  }),
  render: marginScreen,
  play: selectMargin,
};

const insideWork = (tab: string, index = 0): Story => ({
  beforeEach({ msw }) {
    history.replaceState(null, "", `#works/${works[index].id}/${tab}`);
    msw.use(...warehouseHandlers);
  },
  render: workScreen,
});
export const ObraInterior: Story = {
  ...insideWork("work"),
  name: "Dentro de una obra · Coordinación y equipo",
};
export const ObraSolicitudes: Story = {
  ...insideWork("supplies"),
  name: "Dentro de una obra · Solicitudes a Almacén",
};
export const ObraMateriales: Story = {
  ...insideWork("materials"),
  name: "Dentro de una obra · Materiales y equipos",
};
export const ObraDocumentos: Story = {
  ...insideWork("financials"),
  name: "Dentro de una obra · Guías, facturas y gastos",
};
export const ObraCierre: Story = {
  ...insideWork("closeout"),
  name: "Dentro de una obra · Cierre con pendientes",
};
