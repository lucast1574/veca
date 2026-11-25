import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { InventoryWorkspace } from "../../src/features/warehouse/InventoryWorkspace";
import { StoryFrame } from "./StoryFrame";
import { handlers, user } from "./fixtures";
import { orders, warehouseHandlers } from "./warehouse-fixtures";
const meta = {
  title: "VECA/Almacén y stock",
  parameters: { msw: [...warehouseHandlers, ...handlers] },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const screen = (tab: string, selected?: string) => () => (
  <StoryFrame view="inventory">
    <InventoryWorkspace
      user={user}
      accountingAccess
      tab={tab}
      selected={selected}
    />
  </StoryFrame>
);
export const SolicitudesDeObra: Story = {
  name: "01 · Las solicitudes llegan desde Obras",
  render: screen("solicitudes"),
};
export const PedidosPorRecibir: Story = {
  name: "02 · Pedidos y recepciones de proveedores",
  render: screen("compras"),
};
export const FacturaEnviadaPorContabilidad: Story = {
  name: "03 · Materiales enviados desde Contabilidad",
  render: screen("compras", orders[0].id),
};
export const PrepararMateriales: Story = {
  ...FacturaEnviadaPorContabilidad,
  name: "04 · Identificar los materiales de la factura",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Preparar recepción" }),
    );
    await userEvent.click(
      await page.findByRole("combobox", { name: "Código o material" }),
    );
    await expect(
      page.findByRole("option", { name: /VID-T10/ }),
    ).resolves.toBeVisible();
  },
};
export const RecepcionDeMaterial: Story = {
  name: "05 · Confirmar lo recibido y aumentar el stock",
  render: screen("compras", orders[1].id),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Registrar recepción" }),
    );
    await expect(
      page.findByRole("heading", { name: "Registrar recepción de material" }),
    ).resolves.toBeVisible();
  },
};
export const PedidoRecibido: Story = {
  name: "06 · Recepción completa e historial",
  render: screen("compras", orders[2].id),
};
