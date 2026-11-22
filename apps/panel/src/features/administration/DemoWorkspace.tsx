import { useEffect, useId, useState } from "react";
import { ArrowLeft, ChevronRight, ClipboardList } from "lucide-react";
import { DEMO_CASES, type DemoInvoice, type DemoLink } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../components/ui";
import { API_BASE, api, post } from "../../lib/api";
import { DemoPhoto } from "./DemoPhoto";
import "./demo-workspace.css";

const roles = [
  { value: "commercial", label: "Comercial" },
  { value: "operations", label: "Operaciones" },
  { value: "warehouse", label: "Almacén" },
  { value: "accounting", label: "Contabilidad" },
  { value: "management", label: "Gerencia" },
] as const;
type Role = (typeof roles)[number]["value"];
const money = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  maximumFractionDigits: 0,
});
const invoiceStatus: Record<string, string> = {
  accepted: "Aceptada en prueba",
  accepted_with_observations: "Aceptada con observaciones en prueba",
  processing: "Procesando en prueba",
  rejected: "Rechazada en prueba",
};
const name = (label: string) => label.replace(/^\[DEMO\] /, "");
const accountingTabs = [
  "Guías",
  "Facturas y cobros",
  "Compras y gastos",
  "Impuestos",
] as const;

export function DemoWorkspace({ back }: { back: () => void }) {
  const select = useId();
  const [role, setRole] = useState<Role>("accounting");
  const [tab, setTab] = useState<(typeof accountingTabs)[number]>("Guías");
  const [invoices, setInvoices] = useState<DemoInvoice[]>([]);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [links, setLinks] = useState<DemoLink[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void api<DemoLink[]>("/admin/administration/demo", {
      signal: controller.signal,
    })
      .then((rows) => {
        if (!controller.signal.aborted) setLinks(rows);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    void api<DemoInvoice[]>("/admin/administration/demo/invoices", {
      signal: controller.signal,
    })
      .then((rows) => {
        if (!controller.signal.aborted) setInvoices(rows);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function prepare() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const rows = await post<DemoLink[]>(
        "/admin/administration/demo/prepare",
        {},
      );
      setLinks(rows);
      setNotice(
        rows.filter((row) => row.dispatchId).length === 2
          ? "Los dos casos están listos en Leads y Guías de remisión."
          : "Se prepararon los casos de demostración disponibles.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generateInvoices() {
    setInvoiceBusy(true);
    setError("");
    setNotice("");
    try {
      setInvoices(
        await post<DemoInvoice[]>("/admin/administration/demo/invoices", {}),
      );
      setNotice("Comprobantes actualizados en el entorno de prueba.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInvoiceBusy(false);
    }
  }

  const prepared = links.filter((row) => row.dispatchId).length === 2;
  return (
    <main className="ops-page demo-workspace">
      <button className="ops-back" onClick={back}>
        <ArrowLeft size={17} /> Administración
      </button>
      <header className="demo-workspace-head">
        <div>
          <span className="demo-marker">Datos de ejemplo</span>
          <h1>Demostración por rol</h1>
        </div>
        {!prepared && (
          <Button
            type="button"
            disabled={busy || !links.length}
            onClick={() => void prepare()}
          >
            <ClipboardList size={16} />{" "}
            {busy ? "Cargando…" : "Preparar casos demo"}
          </Button>
        )}
      </header>
      <div className="demo-role-select">
        <Field label="Mostrar trabajo de" htmlFor={select}>
          <Select
            id={select}
            label="Mostrar trabajo de"
            value={role}
            options={[...roles]}
            onChange={(value) => setRole(value as Role)}
          />
        </Field>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {role === "accounting" && (
        <nav
          className="lead-detail-tabs"
          aria-label="Secciones de Contabilidad"
        >
          {accountingTabs.map((item) => (
            <button
              key={item}
              aria-pressed={item === tab}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      )}
      {role === "accounting" && tab === "Facturas y cobros" && (
        <div className="demo-invoice-actions">
          <Button
            variant="ghost"
            disabled={invoiceBusy}
            onClick={() => void generateInvoices()}
          >
            {invoiceBusy
              ? "Consultando…"
              : invoices.length
                ? "Actualizar facturas de prueba"
                : "Generar facturas de prueba"}
          </Button>
        </div>
      )}
      <div className="demo-workspace-grid">
        {DEMO_CASES.map((example) => {
          const link = links.find((item) => item.key === example.key);
          const label = name(example.name);
          const invoice = invoices.find((item) => item.key === example.key);
          const totals = Math.round(example.sale * 1.18);
          return (
            <section className="ops-card demo-workspace-case" key={example.key}>
              <DemoPhoto demo={example.key} />
              <h2>{label}</h2>
              {role === "commercial" && (
                <>
                  <p>{example.idea}</p>
                  <DemoFacts
                    entries={[
                      ["Cliente", "Cliente de ejemplo"],
                      ["Presupuesto sin IGV", money.format(example.sale)],
                    ]}
                  />
                </>
              )}
              {role === "operations" && (
                <DemoFacts
                  entries={[
                    ["Material", example.material],
                    ["Cantidad", String(example.quantity)],
                    ["Compra", example.order],
                    ["Motivo", example.reason],
                    [
                      "Despacho",
                      example.transport === "02"
                        ? "Vehículo propio"
                        : "Flete externo",
                    ],
                  ]}
                />
              )}
              {role === "warehouse" && (
                <DemoFacts
                  entries={[
                    ["Código", example.sku],
                    ["Material", example.material],
                    ["Cantidad", String(example.quantity)],
                    ["Equipo por devolver", example.equipment],
                  ]}
                />
              )}
              {role === "management" && (
                <DemoFacts
                  entries={[
                    ["Venta neta", money.format(example.sale)],
                    ["Costo registrado", money.format(example.cost)],
                    ["Margen", money.format(example.sale - example.cost)],
                    [
                      "Saldo por cobrar",
                      money.format(totals - example.collected),
                    ],
                  ]}
                />
              )}
              {role === "accounting" && tab === "Guías" && (
                <DemoFacts
                  entries={[
                    [
                      "Transporte",
                      example.transport === "02"
                        ? "Vehículo propio"
                        : "Flete externo",
                    ],
                    [
                      "Estado de ejemplo",
                      example.guideStatus === "review"
                        ? "Lista para revisar"
                        : "Devuelta · falta RUC del transportista",
                    ],
                  ]}
                />
              )}
              {role === "accounting" && tab === "Facturas y cobros" && (
                <DemoFacts
                  entries={[
                    [
                      invoice ? "Factura de prueba" : "Factura ilustrativa",
                      invoice?.number ??
                        (example.key === "mamparas"
                          ? "Venta de obra"
                          : "Primer hito"),
                    ],
                    ["Total con IGV", money.format(totals)],
                    ...(invoice
                      ? [
                          [
                            "Estado",
                            invoiceStatus[invoice.status] ||
                              "Por revisar en prueba",
                          ] as [string, string],
                        ]
                      : []),
                    ["Cobrado", money.format(example.collected)],
                    ["Por cobrar", money.format(totals - example.collected)],
                  ]}
                />
              )}
              {role === "accounting" &&
                tab === "Facturas y cobros" &&
                invoice?.number && (
                  <a
                    className="dispatch-link"
                    href={`${API_BASE}/admin/administration/demo/invoices/${example.key}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver PDF de prueba <ChevronRight size={16} />
                  </a>
                )}
              {role === "accounting" && tab === "Compras y gastos" && (
                <DemoFacts
                  entries={[
                    ["Compra", example.order],
                    ["Motivo", example.reason],
                    [example.charge, money.format(example.expense)],
                  ]}
                />
              )}
              {role === "accounting" && tab === "Impuestos" && (
                <DemoFacts
                  entries={[
                    ["Venta neta de ejemplo", money.format(example.sale)],
                    ["IGV ilustrativo", money.format(totals - example.sale)],
                    ["Sustento", "Comprobante de ejemplo por conciliar"],
                  ]}
                />
              )}
              {link?.leadId && ["commercial", "operations"].includes(role) && (
                <a className="dispatch-link" href={`#leads/${link.leadId}`}>
                  Abrir ficha demo <ChevronRight size={16} />
                </a>
              )}
              {role === "accounting" && tab === "Guías" && link?.dispatchId && (
                <a
                  className="dispatch-link"
                  href={`#accounting/${link.dispatchId}`}
                >
                  Abrir despacho demo <ChevronRight size={16} />
                </a>
              )}
            </section>
          );
        })}
      </div>
      {role === "accounting" && tab === "Facturas y cobros" && (
        <p className="hint">
          Venta directa de ejemplo · 2 kits de herrajes · {money.format(354)}{" "}
          con IGV.
        </p>
      )}
    </main>
  );
}

function DemoFacts({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="demo-workspace-facts">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
