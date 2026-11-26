import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { SessionUser } from "@veca/content";
import { AccountingWorkspace } from "../../src/features/accounting/AccountingWorkspace";
import { InventoryWorkspace } from "../../src/features/warehouse/InventoryWorkspace";
import { StoryFrame } from "./StoryFrame";
import { handlers, user } from "./fixtures";
import { materials, orders, warehouseHandlers } from "./warehouse-fixtures";
const meta = {
  title: "VECA/Almacén y stock",
  parameters: { msw: [...warehouseHandlers, ...handlers] },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const warehouseUser: SessionUser = {
  ...user,
  name: "Jorge Quispe",
  roleName: "Almacén",
  permissions: [
    "dashboard",
    "inventory",
    "inventory_receive",
    "inventory_adjust",
    "inventory_request",
    "inventory_dispatch",
    "inventory_reserve",
  ],
};
const accountant: SessionUser = {
  ...user,
  roleName: "Contabilidad",
  permissions: ["dashboard", "accounting", "accounting_write"],
};
const screen = (tab: string, selected?: string) => () => (
  <StoryFrame view="inventory" sessionUser={warehouseUser}>
    <InventoryWorkspace
      user={warehouseUser}
      accountingAccess={false}
      tab={tab}
      selected={selected}
    />
  </StoryFrame>
);
const accountingScreen = () => (
  <StoryFrame view="accounting" sessionUser={accountant}>
    <AccountingWorkspace user={accountant} inventoryAccess={false} />
  </StoryFrame>
);
export const SolicitudesDeObra: Story = {
  name: "01 · Las solicitudes llegan desde Obras",
  render: screen("solicitudes"),
};
function MaterialesStory({ materialId }: { materialId?: string }) {
  const [selected, setSelected] = useState(materialId);
  useEffect(() => {
    const navigate = () => setSelected(location.hash.split("/")[2]);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return (
    <StoryFrame view="inventory" sessionUser={warehouseUser}>
      <InventoryWorkspace
        user={warehouseUser}
        tab="materiales"
        selected={selected}
      />
    </StoryFrame>
  );
}
export const MaterialesEnAlmacen: Story = {
  name: "Stock disponible y acciones de materiales",
  render: () => <MaterialesStory />,
};
export const HistorialDeMaterial: Story = {
  name: "Historial de stock de un material",
  render: () => <MaterialesStory materialId={materials[0].id} />,
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
  name: "04 · Contabilidad registra cantidades y precios",
  beforeEach() {
    history.replaceState(
      null,
      "",
      `#accounting/gastos/${orders[0].id}/preparar`,
    );
  },
  render: accountingScreen,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("combobox", { name: "Código o material" }),
    );
    await userEvent.click(await page.findByRole("option", { name: /VID-T10/ }));
    await userEvent.type(
      await page.findByRole("spinbutton", { name: "Cantidad comprada" }),
      "12",
    );
    await userEvent.type(
      await page.findByRole("spinbutton", { name: "Precio unitario sin IGV" }),
      "470",
    );
    await expect(
      page.findByRole("button", { name: "Enviar a Almacén" }),
    ).resolves.toBeEnabled();
  },
};
export const PendientesEnContabilidad: Story = {
  name: "03b · Bandeja de compras por completar en Contabilidad",
  beforeEach() {
    history.replaceState(null, "", "#accounting/gastos");
  },
  render: accountingScreen,
};
export const MaterialNuevoEnCompra: Story = {
  name: "04b · Registrar un material sin perder la compra",
  beforeEach: PrepararMateriales.beforeEach,
  render: accountingScreen,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(
      await page.findByRole("spinbutton", { name: "Cantidad comprada" }),
      "12",
    );
    await userEvent.type(
      await page.findByRole("spinbutton", { name: "Precio unitario sin IGV" }),
      "470",
    );
    await userEvent.click(
      await page.findByRole("button", { name: "Registrar nuevo" }),
    );
    const dialog = within(
      await page.findByRole("dialog", { name: "Nuevo material" }),
    );
    await userEvent.type(
      dialog.getByRole("textbox", { name: "Nombre del material" }),
      "Vidrio laminado de 10 mm · Ejemplo",
    );
    await userEvent.type(
      dialog.getByRole("textbox", { name: "Código / SKU" }),
      "VID-L10",
    );
    await userEvent.click(
      dialog.getByRole("combobox", { name: "Unidad de medida" }),
    );
    await userEvent.click(
      await page.findByRole("option", { name: /^m²$/ }),
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Crear material" }),
    );
    await expect(
      page.findByRole("combobox", { name: "Código o material" }),
    ).resolves.toHaveValue("VID-L10 · Vidrio laminado de 10 mm · Ejemplo");
    await expect(
      page.getByRole("spinbutton", { name: "Cantidad comprada" }),
    ).toHaveValue(12);
    await expect(
      page.getByRole("spinbutton", { name: "Precio unitario sin IGV" }),
    ).toHaveValue(470);
    await expect(
      page.getByRole("button", { name: "Enviar a Almacén" }),
    ).toBeEnabled();
  },
};
export const RecepcionDeMaterial: Story = {
  name: "05 · Confirmar lo recibido y aumentar el stock",
  render: screen("compras", orders[1].id),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Confirmar recepción" }),
    );
    await expect(
      page.findByRole("heading", { name: "Confirmar recepción de material" }),
    ).resolves.toBeVisible();
  },
};
export const PedidoRecibido: Story = {
  name: "06 · Recepción completa e historial",
  render: screen("compras", orders[2].id),
};
