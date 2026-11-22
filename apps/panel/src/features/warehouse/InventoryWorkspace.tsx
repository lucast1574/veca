import { Inventory } from "../operations/Inventory";
import { EquipmentList } from "./Equipment";
import { Purchases } from "./Purchases";
import "./warehouse.css";

const sections = [
  ["materiales", "Materiales"],
  ["compras", "Compras"],
  ["equipos", "Equipos"],
] as const;

export function InventoryWorkspace({
  tab,
  selected,
  workId,
}: {
  tab?: string;
  selected?: string;
  workId?: string;
}) {
  const active = sections.some(([value]) => value === tab) ? tab : "materiales";
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
      {active === "materiales" && <Inventory />}
      {active === "compras" && (
        <Purchases
          key={selected || "list"}
          selected={selected === "nueva" ? undefined : selected}
          workId={selected === "nueva" ? workId : ""}
        />
      )}
      {active === "equipos" && (
        <EquipmentList key={selected || "list"} selected={selected} />
      )}
    </div>
  );
}
