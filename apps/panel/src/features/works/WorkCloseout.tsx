import type { WorkCloseout as Closeout } from "@veca/content";
import { CheckCircle2, AlertCircle } from "lucide-react";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { useLiveRefresh } from "../operations/shared";
import "./work-control.css";
export function WorkCloseout({ id }: { id: string }) {
  const query = useAccountingQuery<Closeout>(
    `/admin/work-control/${id}/closeout`,
  );
  useLiveRefresh(query.refresh, false, true, "/admin/works/events");
  return (
    <QueryState {...query}>
      {query.data && <WorkCloseoutChecks data={query.data} id={id} />}
    </QueryState>
  );
}
export function WorkCloseoutChecks({
  data,
  id,
}: {
  data: Closeout;
  id: string;
}) {
  return (
    <section className="ops-card work-closeout">
      <h2>Cierre de la obra</h2>
      <p className="hint">
        El cierre físico comprueba el trabajo, los materiales, los equipos y las
        guías. Los cobros y la revisión económica mantienen su propio
        seguimiento.
      </p>
      <>
        <p className="work-control-result">
          {data.stage === "completed"
            ? "Obra realizada"
            : data.ready
              ? "Lista para la revisión de cierre"
              : "Hay pendientes antes del cierre"}
        </p>
        <ul className="work-checks">
          {data.checks.map((check) => (
            <li key={check.key} data-pending={check.count > 0 || undefined}>
              {check.count ? (
                <AlertCircle size={17} />
              ) : (
                <CheckCircle2 size={17} />
              )}
              <span>
                {check.label}
                {!check.blocking && <small>Seguimiento documental</small>}
              </span>
              <strong>{check.count}</strong>
            </li>
          ))}
        </ul>
        {data.checks.some(
          (c) =>
            c.count &&
            ["requests", "receipts", "returns", "reservations"].includes(c.key),
        ) && (
          <a className="warehouse-link" href={`#works/${id}/supplies`}>
            Revisar solicitudes y devoluciones
          </a>
        )}
      </>
    </section>
  );
}
