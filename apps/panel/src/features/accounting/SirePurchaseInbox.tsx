import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  CloudDownload,
  FileCheck2,
  LoaderCircle,
  ReceiptText,
} from "lucide-react";
import type { SirePurchasePage, SireReconciliation } from "@veca/content";
import { Button, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useAccountingPermission } from "./AccountingAccess";
import {
  accountingPath,
  accountingPost,
  amount,
  displayDate,
  sireDocumentLabel,
  Pagination,
  QueryState,
  useAccountingQuery,
} from "./accounting-shared";
import { SireAutomaticDialog } from "./SireAutomaticDialog";
import { SireFileDialog } from "./SireFileDialog";
import { SirePurchaseDialog } from "./SirePurchaseDialog";
import { SireComparisonResult } from "./SireComparisonResult";
import { useSirePurchaseRefresh } from "./useSirePurchaseRefresh";
import "./sire.css";
const statuses = {
  pending: "Falta indicar su destino",
  registered: "Ya guardada",
  different: "Importe por revisar",
  manual: "Necesita revisión",
};
export function SirePurchaseInbox({
  month,
  onSaved,
  revision = 0,
}: {
  revision?: number;
  month: string;
  onSaved: (purchaseId?: string) => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [state, setState] = useState<"pending" | "all">("pending");
  const [page, setPage] = useState(1);
  const [newSince, setNewSince] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [focusNew, setFocusNew] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const query = useAccountingQuery<SirePurchasePage>(
    `${accountingPath}/sire/purchases?month=${month}&page=${page}&state=${state}${newSince ? `&newSince=${encodeURIComponent(newSince)}` : ""}`,
  );
  const lastPage = useRef<SirePurchasePage | undefined>(undefined);
  useEffect(() => {
    if (query.data) lastPage.current = query.data;
  }, [query.data]);
  const refresh = useSirePurchaseRefresh(month, (since) => {
    setNewSince(since);
    setState("all");
    setPage(1);
    setFinishing(true);
    query.refresh();
  });
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") query.refresh();
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [query.refresh]);
  useEffect(() => {
    if (revision) query.refresh();
  }, [revision, query.refresh]);
  const requested = useRef(false);
  useEffect(() => {
    if (
      !canWrite ||
      !query.data ||
      query.data.syncedAt ||
      query.data.syncing ||
      requested.current
    )
      return;
    requested.current = true;
    const abort = new AbortController();
    void accountingPost(
      `${accountingPath}/period/${month}/reconcile/purchases/automatic`,
      {},
    )
      .then(() => {
        if (!abort.signal.aborted) query.refresh();
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) {
          setNotice(error.message);
          query.refresh();
        }
      });
    return () => abort.abort();
  }, [
    canWrite,
    month,
    query.data?.syncedAt,
    query.data?.syncing,
    Boolean(query.data),
    query.refresh,
  ]);
  const [dialog, setDialog] = useState<"compare" | "file" | "result" | null>(
    null,
  );
  const [comparison, setComparison] = useState<SireReconciliation>();
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const data = query.data ?? (finishing ? lastPage.current : undefined);
  const updating = refresh.busy || finishing;
  useEffect(() => {
    if (!finishing || query.loading) return;
    if (query.error) {
      setFinishing(false);
      return;
    }
    if (!data) return;
    const count = data.newCount ?? 0;
    setNotice(
      count
        ? `${count === 1 ? "Encontramos 1 compra nueva. La marcamos" : `Encontramos ${count} compras nuevas. Las marcamos`} en la lista.`
        : "No hay compras nuevas. Tu bandeja está al día.",
    );
    setFinishing(false);
    setFocusNew(true);
  }, [finishing, query.loading, query.error, data]);
  useEffect(() => {
    if (!focusNew || selected || dialog || query.loading || updating) return;
    const first = data?.newCount
      ? list.current?.querySelector<HTMLButtonElement>(
          "[data-new-purchase] button",
        )
      : actions.current?.querySelector<HTMLButtonElement>("button");
    if (first) {
      first.focus({ preventScroll: true });
      if (data?.newCount) first.scrollIntoView({ block: "nearest" });
      setFocusNew(false);
    }
  }, [focusNew, selected, dialog, query.loading, updating, data]);
  function compared(result: SireReconciliation) {
    query.refresh();
    setComparison(result);
    setDialog("result");
    setPage(1);
  }
  return (
    <section
      className="ops-card sire-inbox"
      aria-labelledby="sire-purchases-title"
    >
      <header className="sire-inbox-header">
        <div>
          <span className="sire-eyebrow">FACTURAS DE TUS PROVEEDORES</span>
          <h3 id="sire-purchases-title">Compras por registrar</h3>
          <p>
            Las traemos de SUNAT. Abre una compra, indica para qué fue y
            guárdala en VECA.
          </p>
        </div>
        <div className="sire-inbox-actions" ref={actions}>
          <Button
            type="button"
            variant="ghost"
            disabled={!canWrite || updating || !data?.checkedAt}
            aria-busy={updating}
            onClick={() => {
              if (!data?.checkedAt) return;
              setNotice("");
              refresh.refresh(data.checkedAt);
            }}
          >
            {updating ? (
              <LoaderCircle size={17} className="sire-refresh-spinner" />
            ) : (
              <CloudDownload size={17} />
            )}
            {updating ? "Actualizando…" : "Actualizar compras"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!canWrite || updating}
            aria-haspopup="dialog"
            onClick={() => setDialog("compare")}
          >
            <FileCheck2 size={17} />
            Comparar con SUNAT
          </Button>
        </div>
      </header>
      <div className="sire-inbox-summary">
        <div>
          <strong>{data?.pending ?? "—"}</strong>
          <span>por completar</span>
        </div>
        <div>
          <strong>{data ? amount(data.pendingCents) : "—"}</strong>
          <span>en compras por completar</span>
        </div>
        <div>
          <CheckCheck size={17} />
          <span>
            {data?.registered ?? 0} ya guardadas
            {data?.review ? ` · ${data.review} por revisar` : ""}
          </span>
        </div>
      </div>
      <div className="sire-inbox-tools">
        <div className="sire-inbox-tabs" aria-label="Ver compras">
          <button
            type="button"
            aria-pressed={state === "pending"}
            onClick={() => {
              setState("pending");
              setPage(1);
            }}
          >
            Por completar
          </button>
          <button
            type="button"
            aria-pressed={state === "all"}
            onClick={() => {
              setState("all");
              setPage(1);
            }}
          >
            Todas las compras
          </button>
        </div>
        <span className="hint">
          {data?.syncedAt
            ? `Última consulta: ${new Date(data.syncedAt).toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : "Se actualizan automáticamente"}
        </span>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {refresh.error && (
        <Notice error>
          {refresh.error} Pulsa Actualizar compras para reintentar.
        </Notice>
      )}
      {data?.syncFailed && (
        <Notice>
          La actualización automática no pudo terminar. Volveremos a intentarlo;
          tus compras anteriores se conservan. También puedes pulsar Actualizar
          compras.
        </Notice>
      )}
      {(refresh.busy || data?.syncing) && (
        <p className="hint" role="status">
          Estamos trayendo las compras de SUNAT. La bandeja se actualizará sola.
        </p>
      )}
      <QueryState {...query}>
        {data && !query.error && (
          <>
            {!data.items.length ? (
              <div className="sire-inbox-empty">
                <ReceiptText size={24} />
                <strong>
                  {data.total
                    ? "Todo está guardado"
                    : data.syncedAt
                      ? "No encontramos compras en este mes"
                      : data.syncing
                        ? "Estamos buscando tus compras"
                        : "Aún no hay compras descargadas"}
                </strong>
                <p>
                  {data.total
                    ? "Puedes verlas en Todas las compras o en Compras guardadas."
                    : data.syncedAt
                      ? "Cuando aparezcan nuevas facturas en SUNAT, las verás aquí."
                      : "Aparecerán aquí las facturas emitidas al RUC de VECA. También puedes actualizar ahora."}
                </p>
              </div>
            ) : (
              <ul className="sire-purchase-list" ref={list}>
                {data.items.map((row) => (
                  <li
                    key={row.id}
                    data-new-purchase={
                      newSince && row.firstSeenAt && row.firstSeenAt > newSince
                        ? ""
                        : undefined
                    }
                  >
                    <span className="sire-receipt-icon">
                      <ReceiptText size={20} />
                    </span>
                    <div className="sire-purchase-provider">
                      <strong>
                        {row.supplier || `Proveedor · RUC ${row.taxId}`}
                      </strong>
                      <span>
                        {sireDocumentLabel(row.type)} {row.reference} ·{" "}
                        {displayDate(row.date)}
                      </span>
                      <small>{statuses[row.status]}</small>
                      {newSince &&
                        row.firstSeenAt &&
                        row.firstSeenAt > newSince && (
                          <span className="sire-new-purchase">Nueva</span>
                        )}
                    </div>
                    <strong className="sire-purchase-amount">
                      {row.currency === "PEN"
                        ? amount(row.total)
                        : `${row.currency} ${(row.total / 100).toFixed(2)}`}
                    </strong>
                    <Button
                      variant={
                        row.status === "pending" && canWrite
                          ? "primary"
                          : "ghost"
                      }
                      onClick={() => setSelected(row.id)}
                    >
                      {row.status === "pending" && canWrite
                        ? "Completar compra"
                        : "Ver detalle"}
                      <ArrowRight size={15} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
      <Pagination
        page={page}
        hasMore={Boolean(data?.hasMore)}
        change={setPage}
      />
      <p className="sire-inbox-footnote">
        Las compras por completar todavía no se suman a tus gastos. Guardarlas
        no declara impuestos ni cambia el stock.
      </p>
      {dialog === "compare" && (
        <SireAutomaticDialog
          month={month}
          initialBook="purchases"
          lockBook
          close={() => setDialog(null)}
          manual={() => setDialog("file")}
          done={compared}
        />
      )}
      {dialog === "file" && (
        <SireFileDialog
          month={month}
          initialBook="purchases"
          lockBook
          close={() => setDialog(null)}
          done={compared}
        />
      )}
      {dialog === "result" && comparison && (
        <Modal
          title={`Comparación de compras · ${month}`}
          description="Revisa las coincidencias y los comprobantes que necesitan atención."
          size="wide"
          onClose={() => setDialog(null)}
          footer={
            <footer className="ve-modal-actions">
              <Button type="button" onClick={() => setDialog(null)}>
                Volver a las compras
              </Button>
            </footer>
          }
        >
          <SireComparisonResult result={comparison} />
        </Modal>
      )}
      {selected && (
        <SirePurchaseDialog
          id={selected}
          canWrite={canWrite}
          close={() => setSelected("")}
          saved={(purchaseId) => {
            setSelected("");
            setNotice(
              purchaseId
                ? "Factura guardada. Completa los materiales y precios para enviarla a Almacén."
                : "Compra guardada. Ya puedes verla en Compras guardadas.",
            );
            query.refresh();
            onSaved(purchaseId);
          }}
        />
      )}
    </section>
  );
}
