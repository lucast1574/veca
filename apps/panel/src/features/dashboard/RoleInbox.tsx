import { useState } from "react";
import type { InboxSection } from "@veca/content";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { useLiveRefresh } from "../operations/shared";
import "./role-inbox.css";
export function RoleInbox() {
  const query = useAccountingQuery<InboxSection[]>("/admin/dashboard/inbox");
  useLiveRefresh(query.refresh, false);
  const [selected, setSelected] = useState("");
  const active = query.data?.filter((s) => s.count > 0) || [];
  const current = active.find((s) => s.key === selected) || active[0];
  return (
    <section className="role-inbox role-inbox-v2">
      <header className="workspace-section-head">
        <div>
          <span className="dash-eyebrow">Qué sigue</span>
          <h2>Tu trabajo pendiente</h2>
        </div>
        {!!active.length && (
          <span className="dash-queue-total">
            {active.reduce((n, s) => n + s.count, 0)} pendientes en tus bandejas
          </span>
        )}
      </header>
      <QueryState {...query}>
        {!active.length ? (
          <div className="dash-inbox-clear">
            <CheckCircle2 size={20} />
            <p>No tienes pendientes registrados en tus bandejas.</p>
          </div>
        ) : (
          <>
            <div className="dash-inbox-tabs" aria-label="Elegir bandeja">
              {active.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  aria-pressed={current?.key === s.key}
                  onClick={() => setSelected(s.key)}
                >
                  <span>{s.title}</span>
                  <b>{s.count}</b>
                </button>
              ))}
            </div>
            {current && (
              <div className="dash-inbox-items">
                {current.items.slice(0, 3).map((i) => (
                  <a className="workspace-row" key={i.id} href={i.href}>
                    <span>
                      <strong>{i.title}</strong>
                      <small>{i.detail}</small>
                    </span>
                    <ArrowUpRight size={16} />
                  </a>
                ))}
                <a href={current.href} className="warehouse-link">
                  Abrir {current.title.toLowerCase()} <ArrowUpRight size={15} />
                </a>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
