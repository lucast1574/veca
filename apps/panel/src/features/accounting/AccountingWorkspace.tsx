import type { SessionUser } from "@veca/content";
import { AccountingAccess } from "./AccountingAccess";
import { useEffect, useState } from "react";
import { GuideAccounting } from "../dispatch/GuideAccounting";
import { AccountingInvoices } from "./AccountingInvoices";
import { AccountingCosts } from "./AccountingCosts";
import { Margin, TaxPeriod } from "./AccountingReports";
import { LaborWorkspace } from "./labor/LaborWorkspace";
import "./accounting.css";

const tabs = [
  ["guias", "Guías de remisión"],
  ["facturas", "Facturas y cobros"],
  ["gastos", "Compras y gastos"],
  ["personal", "Planilla y honorarios"],
  ["impuestos", "Impuestos"],
  ["margen", "Margen por obra"],
] as const;

function locationSection() {
  const [path, search] = location.hash.split("?");
  const [, part, id, action] = path.split("/");
  const rawMonth = new URLSearchParams(search).get("month") || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : undefined;
  const tab = tabs.find(([value]) => value === part);
  return tab
    ? { tab: tab[0], id, prepare: action === "preparar", month }
    : { tab: "guias" as const, id: part, prepare: false, month };
}

export function AccountingWorkspace({
  inventoryAccess,
  user,
}: {
  inventoryAccess: boolean;
  user: SessionUser;
}) {
  const [route, setRoute] = useState(locationSection);
  useEffect(() => {
    const onChange = () => setRoute(locationSection());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return (
    <AccountingAccess.Provider value={user.permissions}>
      <main className="ops-page accounting-workspace">
        <header className="accounting-title">
          <h1>Contabilidad</h1>
        </header>
        <nav className="accounting-tabs" aria-label="Secciones de Contabilidad">
          {tabs
            .filter(
              ([id]) =>
                id !== "personal" ||
                user.permissions.includes("accounting_labor"),
            )
            .map(([id, label]) => (
              <a
                key={id}
                href={`#accounting/${id}`}
                aria-current={route.tab === id ? "page" : undefined}
              >
                {label}
              </a>
            ))}
        </nav>
        {route.tab === "guias" && (
          <GuideAccounting
            selected={route.id === "revision" ? "" : route.id || ""}
            inventoryAccess={inventoryAccess}
            initialFilter={route.id === "revision" ? "review" : "all"}
            key={route.id === "revision" ? "review" : "default"}
          />
        )}
        {route.tab === "facturas" && (
          <AccountingInvoices
            selected={
              ["solicitadas", "por-cobrar", "sunat"].includes(route.id || "")
                ? ""
                : route.id || ""
            }
            review={route.id === "sunat"}
            initialMonth={route.month}
            queue={
              route.id === "solicitadas"
                ? "requested"
                : route.id === "por-cobrar"
                  ? "collect"
                  : ""
            }
            key={`${route.id || "list"}:${route.month || ""}`}
          />
        )}
        {route.tab === "gastos" && (
          <AccountingCosts
            key={`${route.id || "all"}:${route.prepare}:${route.month || ""}`}
            purchaseId={route.id}
            preparePurchase={route.prepare}
            inventoryAccess={inventoryAccess}
            initialMonth={route.month}
          />
        )}
        {route.tab === "personal" &&
          user.permissions.includes("accounting_labor") && <LaborWorkspace />}
        {route.tab === "impuestos" && (
          <TaxPeriod
            key={route.month || "current"}
            initialMonth={route.month}
          />
        )}
        {route.tab === "margen" && <Margin />}
      </main>
    </AccountingAccess.Provider>
  );
}
