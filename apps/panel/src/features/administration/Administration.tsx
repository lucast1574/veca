import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, RefreshCw } from "lucide-react";
import {
  LEAD_SOURCE_LABELS,
  SOCIAL_CHANNELS,
  type AccountStatus,
  type AdministrationOverview,
  type SocialChannel,
  type SocialCheckGroup,
} from "@veca/content";
import { api } from "../../lib/api";
import { Button, Notice } from "../../components/ui";
import "./administration.css";

const timestamp = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Lima",
});
const accountLabels: Record<AccountStatus, string> = {
  active: "Activo",
  pending: "Pendiente",
  suspended: "Suspendido",
  rejected: "Rechazado",
};
const checks = [
  ["publications", "Publicaciones", 45],
  ["inboxes", "Mensajes", 15],
] as const;

function readConnection(
  connections: AdministrationOverview["connections"],
  group: SocialCheckGroup,
  channel: SocialChannel,
  maxMinutes: number,
) {
  const snapshot = connections[group];
  const checkedAt = snapshot?.checkedAt;
  const status = snapshot?.accounts.find(
    (account) => account.channel === channel,
  )?.status;
  if (!checkedAt || !status)
    return { label: "Por verificar", tone: "pending", checkedAt };
  if (Date.now() - Date.parse(checkedAt) > maxMinutes * 60000)
    return { label: "Sin verificación reciente", tone: "pending", checkedAt };
  if (status === "verified")
    return { label: "Conectada", tone: "ok", checkedAt };
  return {
    label:
      status === "login" ? "Requiere inicio de sesión" : "Revisar conexión",
    tone: "review",
    checkedAt,
  };
}

export function Administration() {
  const [data, setData] = useState<AdministrationOverview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError("");
    try {
      const overview = await api<AdministrationOverview>(
        "/admin/administration",
        { signal },
      );
      if (!signal?.aborted) setData(overview);
    } catch (error) {
      if (!signal?.aborted) setError((error as Error).message);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  const active = data?.team.filter(
    (person) => person.status === "active",
  ).length;
  const pending = data?.team.filter(
    (person) => person.status === "pending",
  ).length;

  return (
    <main className="ops-page administration" aria-busy={busy}>
      <header className="administration-heading">
        <div>
          <h1>Administración</h1>
          <p>Conexiones de redes, operación de VECA y actividad del equipo.</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void reload()}>
          <RefreshCw size={16} aria-hidden="true" />
          {busy ? "Consultando…" : "Actualizar datos"}
        </Button>
      </header>
      {error && <Notice error>{error}</Notice>}
      {!data && busy && <p role="status">Cargando administración…</p>}
      {data && (
        <>
          <section
            className="administration-section"
            aria-labelledby="administration-connections"
          >
            <div className="administration-section-heading">
              <h2 id="administration-connections">Conexiones de redes</h2>
              <p>
                Últimas comprobaciones del navegador de VECA para publicar y
                leer mensajes.
              </p>
            </div>
            <div className="administration-networks">
              {SOCIAL_CHANNELS.map((channel) => {
                const delivery = data.deliveries[channel];
                return (
                  <article key={channel} className="administration-card">
                    <h3>{LEAD_SOURCE_LABELS[channel]}</h3>
                    <dl className="administration-checks">
                      {checks.map(([group, label, maxMinutes]) => {
                        const check = readConnection(
                          data.connections,
                          group,
                          channel,
                          maxMinutes,
                        );
                        const Icon =
                          check.tone === "ok"
                            ? CheckCircle2
                            : check.tone === "review"
                              ? CircleAlert
                              : Clock3;
                        return (
                          <div key={group}>
                            <dt>{label}</dt>
                            <dd>
                              <span
                                className="administration-check"
                                data-tone={check.tone}
                              >
                                <Icon size={15} aria-hidden="true" />
                                {check.label}
                              </span>
                              {check.checkedAt && (
                                <time dateTime={check.checkedAt}>
                                  {timestamp.format(new Date(check.checkedAt))}
                                </time>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    <p className="administration-card-detail">
                      Confirmados <strong>{delivery.published}</strong> ·{" "}
                      Pendientes <strong>{delivery.pending}</strong> · Por
                      revisar <strong>{delivery.review}</strong>
                    </p>
                    <p className="administration-card-detail">
                      Leads en 30 días{" "}
                      <strong>{data.leads.byChannel[channel]}</strong>
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
          <section
            className="administration-section"
            aria-labelledby="administration-metrics"
          >
            <div className="administration-section-heading">
              <h2 id="administration-metrics">Operación de la app</h2>
            </div>
            <dl className="administration-metrics">
              <div className="administration-card">
                <dt>Obras publicadas</dt>
                <dd>{data.projects.published}</dd>
              </div>
              <div className="administration-card">
                <dt>Borradores de obra</dt>
                <dd>{data.projects.drafts}</dd>
              </div>
              <div className="administration-card">
                <dt>Leads en 30 días</dt>
                <dd>{data.leads.received}</dd>
              </div>
              <div className="administration-card">
                <dt>Preleads por contactar</dt>
                <dd>{data.leads.preleads}</dd>
              </div>
            </dl>
          </section>
          <section
            className="administration-section"
            aria-labelledby="administration-team"
          >
            <div className="administration-section-heading">
              <h2 id="administration-team">Actividad del equipo</h2>
              <p>
                {active} cuentas activas · {pending} pendientes. Actividad
                registrada en los últimos 30 días.
              </p>
            </div>
            {data.team.length ? (
              <ul className="administration-team">
                {data.team.map((person) => (
                  <li className="administration-card" key={person.id}>
                    <div>
                      <h3>{person.name}</h3>
                      <p>
                        {person.role ?? "Sin rol asignado"} ·{" "}
                        {accountLabels[person.status]}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Acciones en CRM</dt>
                        <dd>{person.activity.crm}</dd>
                      </div>
                      <div>
                        <dt>Movimientos de inventario</dt>
                        <dd>{person.activity.inventory}</dd>
                      </div>
                    </dl>
                    <p>
                      {person.activity.last ? (
                        <>
                          Último registro{" "}
                          <time dateTime={person.activity.last}>
                            {timestamp.format(new Date(person.activity.last))}
                          </time>
                        </>
                      ) : (
                        "Sin actividad en el periodo"
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>El panel todavía no tiene cuentas de equipo registradas.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
