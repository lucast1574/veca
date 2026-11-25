import { RoleInbox } from "./RoleInbox";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Package, RefreshCw } from "lucide-react";
import type { SessionUser } from "@veca/content";
import { api } from "../../lib/api";
import { Notice } from "../../components/ui";
import { useLiveRefresh, date, amount, unitName } from "../operations/shared";
import {
  ActivityChart,
  DashboardFinance,
  Distribution,
  type Visuals,
} from "./DashboardCharts";
import "./dashboard.css";
type Summary = {
  stages: Record<string, number>;
  upcoming: {
    id: string;
    name: string;
    appointment: string;
    district: string;
  }[];
  lowStock: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    balance: number;
    minimum: number;
  }[];
  accounting?: { guides: number; requests: number; collect: number } | null;
  publishedProjects: number | null;
  pendingUsers: number | null;
  visuals?: Visuals;
};
export function Dashboard({ user }: { user: SessionUser }) {
  const [data, setData] = useState<Summary | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(() => {
    void api<Summary>("/admin/dashboard")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);
  useLiveRefresh(refresh, false);
  const can = (p: string) => user.permissions.some((v) => v === p),
    v = data?.visuals;
  const stages = can("works") ? v?.workStages || {} : data?.stages || {};
  const current = (stages.coordination || 0) + (stages.execution || 0);
  const stats = [
    ...(can("works")
      ? [
          {
            label: "Obras en marcha",
            value: current,
            detail: "Preparación y ejecución",
            href: "#works",
          },
        ]
      : []),
    ...(can("leads")
      ? [
          {
            label: "Por contactar",
            value: data?.stages.prelead || 0,
            detail: "Consultas por atender",
            href: "#leads/etapa/prelead",
          },
        ]
      : []),
    ...(can("inventory")
      ? [
          {
            label: "Materiales en alerta",
            value: (v?.stock?.low || 0) + (v?.stock?.empty || 0),
            detail: "Disponibilidad por revisar",
            href: "#inventory/materiales",
          },
        ]
      : []),
    ...(can("accounting")
      ? [
          {
            label: "Facturas por cobrar",
            value: data?.accounting?.collect || 0,
            detail: "Saldos pendientes",
            href: "#accounting/facturas/por-cobrar",
          },
        ]
      : []),
    ...(can("projects") && !can("accounting")
      ? [
          {
            label: "Proyectos publicados",
            value: data?.publishedProjects || 0,
            detail: "Visibles en la web",
            href: "#projects",
          },
        ]
      : []),
  ].slice(0, 4);
  return (
    <main className="ops-page workspace-dashboard dashboard-v2">
      <header className="workspace-welcome">
        <div>
          <p>{user.roleName} · Vidrios VECA</p>
          <h1>
            Hola, {user.name.split(" ")[0]}
            <span>.</span>
          </h1>
          <p>Qué necesita atención y cómo avanza el trabajo.</p>
        </div>
        <button
          className="ops-icon-button"
          onClick={refresh}
          aria-label="Actualizar resumen"
        >
          <RefreshCw size={18} />
        </button>
      </header>
      {error && <Notice error>{error}</Notice>}
      {!data && <p role="status">Cargando tu resumen…</p>}
      {!!data?.pendingUsers && can("users") && (
        <a href="#users" className="dash-access-note">
          {data.pendingUsers} solicitudes de acceso por revisar{" "}
          <ArrowUpRight size={16} />
        </a>
      )}
      {data && (
        <>
          <div className="dash-metric-strip">
            {stats.map((s) => (
              <a href={s.href} key={s.label}>
                <span>{s.label}</span>
                <strong>{s.value}</strong>
                <small>
                  {s.detail}
                  <ArrowUpRight size={14} />
                </small>
              </a>
            ))}
          </div>
          <div
            className={`dash-hero-grid${!v?.activity && !can("accounting") ? " is-single" : ""}`}
          >
            {can("accounting") && !can("leads") ? (
              <DashboardFinance />
            ) : (
              v?.activity && (
                <section className="dash-panel">
                  <header>
                    <div>
                      <span className="dash-eyebrow">Últimos seis meses</span>
                      <h2>Actividad del equipo</h2>
                    </div>
                  </header>
                  <ActivityChart rows={v.activity} />
                </section>
              )
            )}
            <RoleInbox />
          </div>
          <div className="dash-visual-grid">
            {(can("works") || can("leads")) && (
              <section className="dash-panel">
                <header>
                  <div>
                    <span className="dash-eyebrow">Estado actual</span>
                    <h2>
                      {can("works")
                        ? "Obras y entregas"
                        : "Seguimiento comercial"}
                    </h2>
                  </div>
                  <a
                    href={can("works") ? "#works" : "#leads"}
                    className="warehouse-link"
                  >
                    Abrir <ArrowUpRight size={15} />
                  </a>
                </header>
                <div className="dash-stage-rows">
                  {(can("works")
                    ? [
                        ["coordination", "En preparación"],
                        ["execution", "En ejecución"],
                        ["completed", "Realizadas"],
                      ]
                    : [
                        ["prelead", "Por contactar"],
                        ["contacted", "En conversación"],
                        ["coordination", "En coordinación"],
                      ]
                  ).map(([key, label]) => {
                    const count = stages[key] || 0,
                      max = Math.max(1, ...Object.values(stages));
                    return (
                      <a
                        key={key}
                        href={can("works") ? "#works" : `#leads/etapa/${key}`}
                      >
                        <span>
                          {label}
                          <b>{count}</b>
                        </span>
                        <i>
                          <em style={{ width: `${(count / max) * 100}%` }} />
                        </i>
                      </a>
                    );
                  })}
                </div>
                <p className="dash-footnote">
                  {can("works")
                    ? "Obras visibles según tu asignación y permisos."
                    : "Consultas en cada etapa al momento de actualizar."}
                </p>
              </section>
            )}
            {can("inventory") && v?.stock && (
              <section className="dash-panel">
                <header>
                  <div>
                    <span className="dash-eyebrow">Almacén</span>
                    <h2>Disponibilidad de materiales</h2>
                  </div>
                </header>
                <Distribution
                  label="materiales"
                  rows={[
                    {
                      label: "Con existencias",
                      count: v.stock.available || 0,
                      href: "#inventory/materiales",
                    },
                    {
                      label: "Por reponer",
                      count: v.stock.low || 0,
                      href: "#inventory/materiales",
                    },
                    {
                      label: "Sin disponible",
                      count: v.stock.empty || 0,
                      href: "#inventory/materiales",
                    },
                  ]}
                />
              </section>
            )}
            {can("accounting") && can("leads") && <DashboardFinance />}
            {can("projects") && v?.publications && (
              <section className="dash-panel">
                <header>
                  <div>
                    <span className="dash-eyebrow">Publicaciones</span>
                    <h2>Proyectos para la web</h2>
                  </div>
                </header>
                <Distribution
                  label="proyectos"
                  rows={[
                    {
                      label: "Publicados",
                      count: v.publications.published || 0,
                      href: "#projects",
                    },
                    {
                      label: "En borrador",
                      count: v.publications.draft || 0,
                      href: "#projects",
                    },
                  ]}
                />
              </section>
            )}
          </div>
          <div className="dash-visual-grid">
            {can("leads") && (
              <section className="dash-panel">
                <header>
                  <h2>
                    <CalendarDays size={18} /> Próximas coordinaciones
                  </h2>
                </header>
                {data.upcoming.slice(0, 4).map((i) => (
                  <a
                    href={`#leads/${i.id}`}
                    className="workspace-row"
                    key={i.id}
                  >
                    <span>
                      <strong>{i.name}</strong>
                      <small>
                        {date(i.appointment)} · {i.district}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                ))}
                {!data.upcoming.length && (
                  <p className="hint">
                    No hay coordinaciones próximas registradas.
                  </p>
                )}
              </section>
            )}
            {can("inventory") && !!data.lowStock.length && (
              <section className="dash-panel">
                <header>
                  <h2>
                    <Package size={18} /> Revisar existencias
                  </h2>
                  <a href="#inventory/materiales" className="warehouse-link">
                    Ver catálogo
                  </a>
                </header>
                {data.lowStock.slice(0, 4).map((m) => (
                  <a
                    href={`#inventory/materiales/${m.id}`}
                    className="workspace-row"
                    key={m.id}
                  >
                    <span>
                      <strong>{m.name}</strong>
                      <small>
                        Mínimo {amount(m.minimum)} {unitName(m.unit)}
                      </small>
                    </span>
                    <b>
                      {amount(m.balance)} <small>{unitName(m.unit)}</small>
                    </b>
                  </a>
                ))}
              </section>
            )}
          </div>
          {!stats.length && !v?.activity && (
            <section className="dash-panel">
              <h2>Tu espacio en VECA</h2>
              <p className="hint">
                Tus pendientes aparecerán aquí cuando haya acciones disponibles
                para tu puesto.
              </p>
              <a className="warehouse-link" href="#profile">
                Ir a Mi perfil <ArrowUpRight size={15} />
              </a>
            </section>
          )}
        </>
      )}
    </main>
  );
}
