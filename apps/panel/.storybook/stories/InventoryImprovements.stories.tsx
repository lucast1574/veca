import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, within } from "storybook/test";
import type { Equipment, LeadAttachment, WorkQuotation } from "@veca/content";
import { InventoryWorkspace } from "../../src/features/warehouse/InventoryWorkspace";
import { LeadDetail } from "../../src/features/operations/LeadDetail";
import { Margin } from "../../src/features/accounting/MarginDashboard";
import { StoryFrame } from "./StoryFrame";
import { handlers, margin, user, works } from "./fixtures";
import { warehouseHandlers } from "./warehouse-fixtures";
const at = "2026-11-25T14:00:00.000Z";
const quotation: WorkQuotation = {
  attachmentId: "abababababababababababab",
  createdAt: at,
  reference: "COT-2026-042",
  date: "2026-11-25",
  validUntil: "2026-12-10",
  currency: "PEN",
  salesNetCents: 18000000,
  taxRate: 18,
  taxCents: 3240000,
  costBudgetCents: 14000000,
  advanceCents: 10620000,
  paymentTerms: "50 % de adelanto y saldo contra entrega.",
  durationDays: 45,
  durationType: "working",
  executionTerms: "Desde la aprobación de medidas y recepción del adelanto.",
  notes: "Instalación de fachada y sellado de juntas incluidos.",
};
const equipment: Equipment[] = [
  {
    id: "a11111111111111111111111",
    code: "EQ-014",
    name: "Ventosa de elevación",
    category: "machine",
    condition: "good",
    location: "Almacén · Zona A",
    version: 1,
    assignment: {
      workId: works[0].id,
      workName: works[0].workName,
      responsible: "Luis Medina",
      expectedReturn: "2026-12-15",
      at,
    },
    events: [],
  },
  {
    id: "a22222222222222222222222",
    code: "EQ-008",
    name: "Taladro percutor",
    category: "tool",
    condition: "good",
    location: "Almacén · Rack B",
    version: 1,
    assignment: null,
    events: [],
  },
  {
    id: "a33333333333333333333333",
    code: "EQ-021",
    name: "Andamio de aluminio",
    category: "support",
    condition: "maintenance",
    location: "Taller · Zona de mantenimiento",
    version: 1,
    assignment: null,
    events: [],
  },
];
const attachments: LeadAttachment[] = [
  {
    id: quotation.attachmentId,
    leadId: works[0].id,
    name: "Cotizacion-fachada-Alameda.pdf",
    type: "quotation",
    quotation,
    caption: "",
    tags: [],
    sharing: "internal",
    revision: 1,
    url: "/demo-documents/cotizacion.pdf",
    createdAt: at,
  },
  {
    id: "cdcdcdcdcdcdcdcdcdcdcdcd",
    leadId: works[0].id,
    name: "Plano-fachada-piso4.pdf",
    type: "plan",
    caption: "",
    tags: [],
    sharing: "internal",
    revision: 1,
    url: "/demo-documents/plano.pdf",
    createdAt: at,
  },
];
const meta = {
  title: "VECA/Inventario y presupuesto",
  parameters: {
    msw: [
      http.get("*/admin/warehouse/equipment", () =>
        HttpResponse.json(equipment),
      ),
      http.get("*/admin/warehouse/equipment/:id", ({ params }) =>
        HttpResponse.json(equipment.find((e) => e.id === params.id)),
      ),
      http.get("*/admin/accounting/margin/:id", () =>
        HttpResponse.json({
          ...margin,
          quotation,
          budgetCents: quotation.costBudgetCents,
        }),
      ),
      http.get("*/admin/works/:id", () =>
        HttpResponse.json({ lead: works[0], attachments, movements: [] }),
      ),
      ...warehouseHandlers,
      ...handlers,
    ],
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const inventory = (tab: string, selected?: string) => () => (
  <StoryFrame view="inventory">
    <InventoryWorkspace
      user={user}
      accountingAccess
      tab={tab}
      selected={selected}
    />
  </StoryFrame>
);
export const SolicitudesClaras: Story = {
  name: "01 · Qué solicita la obra y qué sigue",
  render: inventory("solicitudes"),
};
export const SolicitarGuia: Story = {
  name: "02 · Solicitar guía a Contabilidad",
  render: inventory("solicitudes"),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      (
        await page.findAllByRole("button", {
          name: "Solicitar guía de remisión",
        })
      )[0],
    );
    await expect(
      page.findByRole("dialog", { name: "Solicitar guía de remisión" }),
    ).resolves.toBeVisible();
  },
};
export const Pedidos: Story = {
  name: "03 · Buscar pedidos y recepciones",
  render: inventory("compras"),
};
export const Equipos: Story = {
  name: "04 · Categoría, ubicación y responsable",
  render: inventory("equipos"),
};
export const NuevoEquipo: Story = {
  name: "05 · Registrar un equipo",
  render: inventory("equipos"),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Nuevo equipo" }),
    );
    await expect(
      page.findByRole("dialog", { name: "Nuevo equipo" }),
    ).resolves.toBeVisible();
  },
};
export const Documentos: Story = {
  name: "06 · Plano y cotización en Resumen",
  beforeEach() {
    history.replaceState(null, "", `#works/${works[0].id}`);
  },
  render: () => (
    <StoryFrame view="works">
      <LeadDetail id={works[0].id} back={() => {}} workView user={user} />
    </StoryFrame>
  ),
};
export const Cotizacion: Story = {
  ...Documentos,
  name: "07 · Cotización con presupuesto y condiciones",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      (await page.findAllByRole("button", { name: "Nueva versión" }))[1],
    );
    await expect(
      page.findByRole("dialog", { name: "Adjuntar cotización" }),
    ).resolves.toBeVisible();
  },
};
export const Proyeccion: Story = {
  name: "08 · Proyección económica de la obra",
  render: () => (
    <StoryFrame view="accounting">
      <main className="ops-page accounting-workspace">
        <Margin />
      </main>
    </StoryFrame>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await userEvent.click(
      await page.findByRole("button", { name: "Proyección" }),
    );
    await expect(page.findByText("Ganancia prevista")).resolves.toBeVisible();
  },
};
export const Materiales: Story = {
  name: "09 · Materiales y filtros de existencias",
  render: inventory("materiales"),
};
