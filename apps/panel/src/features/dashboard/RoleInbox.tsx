import type { InboxSection } from "@veca/content";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { useLiveRefresh } from "../operations/shared";
export function RoleInbox() {
  const query = useAccountingQuery<InboxSection[]>("/admin/dashboard/inbox");
  useLiveRefresh(query.refresh, false);
  const active = query.data?.filter((section) => section.count > 0) || [];
  return (
    <section className="role-inbox">
      <div className="workspace-section-head">
        <h2>Tu trabajo pendiente</h2>
      </div>
      <QueryState {...query}>
        {!active.length && (
          <div className="workspace-section">
            <div className="workspace-empty">
              <CheckCircle2 size={25} />
              <p>No tienes pendientes registrados en tus bandejas.</p>
            </div>
          </div>
        )}
        <div className="workspace-columns">
          {active.map((section) => (
            <section className="workspace-section" key={section.key}>
              <div className="workspace-section-head">
                <h3>
                  {section.title}{" "}
                  <span className="inbox-count">{section.count}</span>
                </h3>
                <a
                  href={section.href}
                  aria-label={`Abrir ${section.title.toLowerCase()}`}
                >
                  <ArrowUpRight size={17} />
                </a>
              </div>
              {section.items.map((item) => (
                <a className="workspace-row" key={item.id} href={item.href}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </a>
              ))}
              {section.count > section.items.length && (
                <a className="warehouse-link" href={section.href}>
                  Ver los {section.count} pendientes
                </a>
              )}
            </section>
          ))}
        </div>
      </QueryState>
    </section>
  );
}

import "./role-inbox.css";
