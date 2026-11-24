import { useState } from "react";
import { Button } from "../../components/ui";
import { DiscardGuideDialog } from "../dispatch/DiscardGuideDialog";
import type {
  WorkFinancials as Financials,
  DispatchStatus,
} from "@veca/content";
import { DISPATCH_STATUS } from "@veca/content";
import { API_BASE } from "../../lib/api";
import {
  QueryState,
  amount,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { useLiveRefresh } from "../operations/shared";
import "./work-control.css";
const statuses: Record<string, string> = {
  requested: "Solicitada",
  draft: "Borrador",
  sending: "Enviando",
  pending: "Por confirmar",
  accepted: "Aceptada",
  observed: "Con observaciones",
  rejected: "Rechazada",
};
export function WorkFinancials({
  id,
  canManage = false,
}: {
  id: string;
  canManage?: boolean;
}) {
  const [discarding, setDiscarding] = useState<Financials["guides"][number]>();
  const query = useAccountingQuery<Financials>(
    `/admin/work-control/${id}/financials`,
  );
  useLiveRefresh(query.refresh, false, true, "/admin/works/events");
  const data = query.data;
  return (
    <section className="ops-card work-financials">
      <h2>Documentos y seguimiento económico</h2>
      <QueryState {...query}>
        {data && (
          <>
            <dl className="work-money">
              {[
                ["Ventas sin IGV", data.margin.sales],
                ["Costos registrados", data.margin.costs],
                ["Cobrado", data.margin.paid],
                ["Por cobrar", data.margin.balance],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{amount(Number(value))}</dd>
                </div>
              ))}
            </dl>
            {(data.margin.pendingValuation ||
              data.margin.manualMaterialsToReview > 0 ||
              !data.margin.labor.available) && (
              <p className="work-control-warning">
                El margen requiere revisión:{" "}
                {data.margin.pendingValuation
                  ? "hay materiales sin valorizar. "
                  : ""}
                {data.margin.manualMaterialsToReview
                  ? "Hay costos manuales de materiales por conciliar. "
                  : ""}
                {!data.margin.labor.available
                  ? "Los costos de personal no están confirmados."
                  : ""}
              </p>
            )}
            <h3>Guías de remisión · {data.counts.guides}</h3>
            <ul className="warehouse-list">
              {data.guides.map((row) => (
                <li key={row.id}>
                  <div>
                    {row.canOpen ? (
                      <a href={`#accounting/guias/${row.id}`}>{row.number}</a>
                    ) : (
                      <strong>Borrador en Operaciones</strong>
                    )}
                    <small>
                      {DISPATCH_STATUS[row.status as DispatchStatus] ||
                        row.status}{" "}
                      ·{" "}
                      {row.departed
                        ? "Salida confirmada"
                        : "Sin salida confirmada"}
                    </small>
                  </div>
                  {canManage &&
                    ["draft", "review", "returned", "rejected"].includes(
                      row.status,
                    ) && (
                      <Button
                        variant="ghost"
                        onClick={() => setDiscarding(row)}
                      >
                        Descartar preparación
                      </Button>
                    )}
                </li>
              ))}
            </ul>
            {!data.guides.length && (
              <p className="hint">No hay guías registradas para esta obra.</p>
            )}
            <h3>Facturas y cobros · {data.counts.invoices}</h3>
            <ul className="warehouse-list">
              {data.invoices.map((row) => (
                <li key={row.id}>
                  <div>
                    <a href={`#accounting/facturas/${row.id}`}>{row.number}</a>
                    <small>
                      {statuses[row.status] || row.status} · Total{" "}
                      {amount(row.total)} · Cobrado {amount(row.paid)}
                    </small>
                    {["accepted", "observed"].includes(row.status) && (
                      <a
                        href={`${API_BASE}/admin/accounting/invoices/${row.id}/file/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Descargar comprobante
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!data.invoices.length && (
              <p className="hint">
                No hay facturas registradas para esta obra.
              </p>
            )}
            <h3>Sustentos y gastos · {data.counts.costs}</h3>
            <ul className="warehouse-list">
              {data.costs.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.supplier}</strong>
                    <small>
                      {row.reviewed ? "Revisado" : "Por revisar"} ·{" "}
                      {row.proof ? "Con sustento" : "Falta sustento"}
                    </small>
                    {row.proof && (
                      <a
                        href={`${API_BASE}/admin/accounting/costs/${row.id}/proof`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Descargar sustento
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {Object.values(data.counts).some((count) => count > 50) && (
              <p className="hint">
                Se muestran los últimos 50 registros de cada sección. El resumen
                incluye todos los movimientos.
              </p>
            )}
            <a className="warehouse-link" href="#accounting/gastos">
              Gestionar compras y gastos
            </a>
          </>
        )}
      </QueryState>
      {discarding && (
        <DiscardGuideDialog
          path={`/admin/accounting/guides/${discarding.id}/discard`}
          version={discarding.version}
          close={() => setDiscarding(undefined)}
          done={() => {
            setDiscarding(undefined);
            query.refresh();
          }}
        />
      )}
    </section>
  );
}
