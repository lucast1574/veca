import { useEffect, useState } from "react";
import { GuideAccounting } from "../dispatch/GuideAccounting";
import { AccountingInvoices } from "./AccountingInvoices";
import { AccountingCosts } from "./AccountingCosts";
import { Margin, TaxPeriod } from "./AccountingReports";
import "./accounting.css";

const tabs = [
  ["guias", "Guías de remisión"],
  ["facturas", "Facturas y cobros"],
  ["gastos", "Compras y gastos"],
  ["impuestos", "Impuestos"],
  ["margen", "Margen por obra"],
] as const;

function locationSection() {
  const [, part, id] = location.hash.split("/");
  const tab = tabs.find(([value]) => value === part);
  return tab ? { tab: tab[0], id } : { tab: "guias" as const, id: part };
}

export function AccountingWorkspace() {
  const [route, setRoute] = useState(locationSection);
  useEffect(() => {
    const onChange = () => setRoute(locationSection());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return (
    <main className="ops-page accounting-workspace">
      <header className="accounting-title">
        <h1>Contabilidad</h1>
      </header>
      <nav className="accounting-tabs" aria-label="Secciones de Contabilidad">
        {tabs.map(([id, label]) => (
          <a
            key={id}
            href={`#accounting/${id}`}
            aria-current={route.tab === id ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {route.tab === "guias" && <GuideAccounting selected={route.id || ""} />}
      {route.tab === "facturas" && (
        <AccountingInvoices
          selected={route.id || ""}
          key={route.id || "list"}
        />
      )}
      {route.tab === "gastos" && <AccountingCosts />}
      {route.tab === "impuestos" && <TaxPeriod />}
      {route.tab === "margen" && <Margin />}
    </main>
  );
}
