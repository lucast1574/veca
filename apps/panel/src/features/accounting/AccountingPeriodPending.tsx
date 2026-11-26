import type { AccountingPeriod } from "@veca/content";

export function SalesPending({ report }: { report: AccountingPeriod }) {
  const pending = report.pendingInvoices;
  if (!pending)
    return (
      <p className="hint">
        Revisa los borradores y envíos pendientes en Facturas y cobros.
      </p>
    );
  const total = pending.toIssue + pending.toConfirm + pending.toCorrect;
  return (
    <p className="accounting-period-pending">
      {total === 0
        ? "Sin facturas pendientes en este periodo."
        : [
            pending.toIssue ? `${pending.toIssue} por emitir` : "",
            pending.toConfirm ? `${pending.toConfirm} por confirmar` : "",
            pending.toCorrect ? `${pending.toCorrect} por corregir` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
    </p>
  );
}

export function PurchasesPending({ report }: { report: AccountingPeriod }) {
  const sire = report.sirePurchases;
  return (
    <div className="accounting-period-pending">
      <p>
        <strong>{report.pendingCosts}</strong> guardadas sin sustento
      </p>
      {sire?.syncedAt ? (
        <>
          <p>
            <strong>{sire.pending}</strong> de SUNAT por completar en VECA
          </p>
          {sire.review > 0 && (
            <p>
              <strong>{sire.review}</strong> de SUNAT con datos por revisar
            </p>
          )}
        </>
      ) : (
        <p>
          Actualiza las compras para comprobar si hay facturas de SUNAT por
          completar.
        </p>
      )}
      {sire?.syncFailed && (
        <p>
          La última consulta a SUNAT no terminó. Las compras descargadas se
          conservan.
        </p>
      )}
    </div>
  );
}
