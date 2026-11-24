import type { SessionUser } from "@veca/content";
import { SupplyRequests } from "./SupplyRequests";
import { Inventory } from "../operations/Inventory";
import { EquipmentList } from "./Equipment";
import { Purchases } from "./Purchases";
import "../accounting/accounting.css";
import "./warehouse.css";

const sections = [
  ["solicitudes", "Solicitudes"],
  ["materiales", "Materiales"],
  ["compras", "Compras"],
  ["equipos", "Equipos"],
] as const;

export function InventoryWorkspace({
  tab,
  selected,
  workId,
  accountingAccess = false,
  user,
}: {
  tab?: string;
  selected?: string;
  workId?: string;
  accountingAccess?: boolean;
  user?: SessionUser;
}) {
  const active = sections.some(([value]) => value === tab)
    ? tab
    : "solicitudes";
  return (
    <div className="ops-page inventory-workspace">
      <header className="accounting-title">
        <h1>Inventario</h1>
      </header>
      <nav className="accounting-tabs" aria-label="Secciones de Inventario">
        {sections.map(([value, title]) => (
          <a
            key={value}
            href={`#inventory/${value}`}
            aria-current={active === value ? "page" : undefined}
          >
            {title}
          </a>
        ))}
      </nav>
      {active === "solicitudes" && user && <SupplyRequests user={user} />}
      {active === "materiales" && (
        <Inventory
          canCatalog={!!user?.permissions.includes("inventory_catalog")}
          canAdjust={!!user?.permissions.includes("inventory_adjust")}
          canReceive={!!user?.permissions.includes("inventory_receive")}
          key={selected || "catalog"}
          materialId={selected}
        />
      )}
      {active === "compras" && (
        <Purchases
          key={selected || "list"}
          accountingAccess={accountingAccess}
          canManage={!!user?.permissions.includes("purchases_manage")}
          canReceive={!!user?.permissions.includes("inventory_receive")}
          selected={selected === "nueva" ? undefined : selected}
          workId={selected === "nueva" ? workId : ""}
        />
      )}
      {active === "equipos" && (
        <EquipmentList
          canManage={!!user?.permissions.includes("inventory_equipment")}
          key={selected || "list"}
          selected={selected}
        />
      )}
    </div>
  );
}
