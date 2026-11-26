import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  CloudDownload,
  FileCheck2,
  LoaderCircle,
} from "lucide-react";
import type {
  AccountingPeriod,
  SireReconciliation,
  SireSalePage,
} from "@veca/content";
import { Button } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useAccountingPermission } from "./AccountingAccess";
import { SalesPending } from "./AccountingPeriodPending";
import { SireAutomaticDialog } from "./SireAutomaticDialog";
import { SireFileDialog } from "./SireFileDialog";
import { SireComparisonResult } from "./SireComparisonResult";
import {
  accountingPath,
  amount,
  displayDate,
  Pagination,
  QueryState,
  sireDocumentLabel,
  Summary,
  useAccountingQuery,
} from "./accounting-shared";
import "./sire.css";
import "./accounting-records.css";

type SunatSale = SireSalePage["items"][number];
const consultationTime = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Lima",
});
const saleTotal = ({ currency, total }: SunatSale) =>
  currency === "PEN"
    ? amount(total)
    : `${currency} ${(total / 100).toFixed(2)}`;

export function SireSalesReview({
  month,
  refreshing = false,
  revision = 0,
  onRefresh,
  onSynced,
  onOpenInvoice,
}: {
  month: string;
  refreshing?: boolean;
  revision?: number;
  onRefresh?: () => void;
  onSynced?: () => void;
  onOpenInvoice?: (id: string) => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const report = useAccountingQuery<AccountingPeriod>(
    `${accountingPath}/period/${month}`,
  );
  const [page, setPage] = useState(1);
  const sales = useAccountingQuery<SireSalePage>(
    `${accountingPath}/sire/sales?month=${month}&page=${page}`,
  );
  const [selected, setSelected] = useState<SunatSale>();
  const [open, setOpen] = useState<"automatic" | "file" | "result" | null>(
    null,
  );
  const [result, setResult] = useState<SireReconciliation>();
  const busy = refreshing || report.loading;
  const lastConsultation = sales.data?.syncedAt
    ? new Date(sales.data.syncedAt)
    : undefined;
  const waiting = Boolean(sales.data?.syncing);
  const linkedInvoice = selected?.invoiceId;
  const canConsult =
    canWrite && !selected?.details && !selected?.review && !linkedInvoice;
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    report.refresh();
  }, [revision, report.refresh]);
  useEffect(() => {
    const timer = setInterval(sales.refresh, 30_000);
    return () => clearInterval(timer);
  }, [sales.refresh]);
  const lastSync = useRef<string | undefined>(undefined);
  const syncedAt = sales.data?.syncedAt;
  useEffect(() => {
    if (!syncedAt || lastSync.current === syncedAt) return;
    lastSync.current = syncedAt;
    report.refresh();
    onSynced?.();
  }, [syncedAt, onSynced, report.refresh]);
  function refresh() {
    report.refresh();
    sales.refresh();
    onRefresh?.();
  }
  function done(next: SireReconciliation) {
    setResult(next);
    setOpen("result");
    refresh();
  }
  return (
    <>
      <section
        className="ops-card sire-inbox sire-sales-summary"
        aria-labelledby="sire-sales-title"
      >
        <header className="sire-inbox-header">
          <div>
            <h3 id="sire-sales-title">Ventas del periodo</h3>
            {report.data && !report.error && (
              <p>
                {report.data.salesCount}{" "}
                {report.data.salesCount === 1
                  ? "factura aceptada"
                  : "facturas aceptadas"}
              </p>
            )}
          </div>
          <div className="sire-inbox-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-busy={busy}
              onClick={refresh}
            >
              {busy ? (
                <LoaderCircle size={17} className="sire-refresh-spinner" />
              ) : (
                <CloudDownload size={17} />
              )}
              {busy ? "Actualizando…" : "Actualizar ventas"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!canWrite}
              aria-haspopup="dialog"
              onClick={() => setOpen("automatic")}
            >
              <FileCheck2 size={17} /> Comparar con SUNAT
            </Button>
          </div>
        </header>
        <QueryState {...report}>
          {report.data && !report.error && (
            <>
              <Summary
                entries={[
                  ["Venta neta", report.data.salesNet],
                  ["IGV de ventas", report.data.salesTax],
                  [
                    "Total facturado",
                    report.data.salesNet + report.data.salesTax,
                  ],
                ]}
              />
              <SalesPending report={report.data} />
            </>
          )}
        </QueryState>
        <section
          className="invoice-records"
          aria-labelledby="sunat-sales-heading"
        >
          <header className="invoice-records-header">
            <h3 id="sunat-sales-heading">Ventas en SUNAT</h3>
            {lastConsultation &&
              Number.isFinite(lastConsultation.getTime()) && (
                <p className="hint invoice-filter-hint">
                  Última consulta · {consultationTime.format(lastConsultation)}
                </p>
              )}
          </header>
          {waiting && (
            <p className="hint" role="status">
              Buscando comprobantes en SUNAT…
            </p>
          )}
          {sales.data?.syncFailed && (
            <p className="hint" role="status">
              La última consulta falló. Usa Comparar con SUNAT para reintentar.
            </p>
          )}
          <QueryState
            {...sales}
            empty={
              waiting || sales.data?.syncFailed
                ? undefined
                : sales.data?.syncedAt
                  ? "No hay comprobantes de SUNAT en este periodo."
                  : "Usa Comparar con SUNAT para consultar este mes."
            }
          >
            {!!sales.data?.items.length && (
              <ul className="accounting-record-list">
                {sales.data.items.map((sale, index) => (
                  <li key={index} className="sunat-sale-row">
                    <div className="accounting-record-label">
                      <strong>{sale.reference || "Sin número"}</strong>
                      <small>
                        {sireDocumentLabel(sale.type)}
                        {sale.taxId && ` · ${sale.taxId}`}
                      </small>
                      {sale.invoiceId ? (
                        <span
                          className="accounting-record-status"
                          data-state="accepted"
                        >
                          Registrada en VECA
                        </span>
                      ) : (
                        sale.review && (
                          <span
                            className="accounting-record-status"
                            data-state="pending"
                          >
                            Por revisar
                          </span>
                        )
                      )}
                    </div>
                    <strong className="accounting-record-amount">
                      {saleTotal(sale)}
                    </strong>
                    <Button variant="ghost" onClick={() => setSelected(sale)}>
                      Ver detalle <ChevronRight size={14} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          <Pagination
            page={page}
            hasMore={!!sales.data?.hasMore}
            change={setPage}
          />
        </section>
      </section>
      {selected && (
        <Modal
          title={selected.reference || "Comprobante de SUNAT"}
          description={`${sireDocumentLabel(selected.type)} · SUNAT`}
          onClose={() => setSelected(undefined)}
          footer={
            (linkedInvoice && onOpenInvoice) || canConsult ? (
              <footer className="ve-modal-actions">
                {linkedInvoice && onOpenInvoice ? (
                  <Button
                    onClick={() => {
                      setSelected(undefined);
                      onOpenInvoice(linkedInvoice);
                    }}
                  >
                    Ver factura en VECA
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setSelected(undefined);
                      setOpen("automatic");
                    }}
                  >
                    Consultar datos en SUNAT
                  </Button>
                )}
              </footer>
            ) : undefined
          }
        >
          <dl className="accounting-record-facts">
            <div className="accounting-record-total">
              <dt>Total</dt>
              <dd>{saleTotal(selected)}</dd>
            </div>
            {selected.details && (
              <>
                <div>
                  <dt>Venta neta</dt>
                  <dd>{amount(selected.details.netCents)}</dd>
                </div>
                <div>
                  <dt>IGV</dt>
                  <dd>{amount(selected.details.taxCents)}</dd>
                </div>
                <div>
                  <dt>Fecha de emisión</dt>
                  <dd>{displayDate(selected.details.issueDate)}</dd>
                </div>
                {selected.details.customer && (
                  <div>
                    <dt>Cliente</dt>
                    <dd>{selected.details.customer}</dd>
                  </div>
                )}
              </>
            )}
            {selected.taxId && (
              <div>
                <dt>Documento del cliente</dt>
                <dd>{selected.taxId}</dd>
              </div>
            )}
          </dl>
          {selected.review && (
            <p className="hint" role="status">
              {selected.review}
            </p>
          )}
          {!selected.invoiceId && !selected.details && !selected.review && (
            <p className="hint">
              Consulta SUNAT para obtener el desglose y registrar la factura
              automáticamente si corresponde.
            </p>
          )}
        </Modal>
      )}
      {open === "automatic" && (
        <SireAutomaticDialog
          month={month}
          initialBook="sales"
          lockBook
          close={() => setOpen(null)}
          manual={() => setOpen("file")}
          done={done}
        />
      )}
      {open === "file" && (
        <SireFileDialog
          month={month}
          initialBook="sales"
          lockBook
          close={() => setOpen(null)}
          done={done}
        />
      )}
      {open === "result" && result && (
        <Modal
          title={`Comparación de ventas · ${month}`}
          description="Revisa las coincidencias y las facturas que necesitan atención."
          size="wide"
          onClose={() => setOpen(null)}
          footer={
            <footer className="ve-modal-actions">
              <Button type="button" onClick={() => setOpen(null)}>
                Volver a las facturas
              </Button>
            </footer>
          }
        >
          <SireComparisonResult result={result} />
        </Modal>
      )}
    </>
  );
}
