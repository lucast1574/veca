import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  CloudDownload,
  ReceiptText,
} from "lucide-react";
import type { SirePurchasePage } from "@veca/content";
import { Button, Notice } from "../../components/ui";
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
}: {
  month: string;
  onSaved: () => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [state, setState] = useState<"pending" | "all">("pending");
  const [page, setPage] = useState(1);
  const query = useAccountingQuery<SirePurchasePage>(
    `${accountingPath}/sire/purchases?month=${month}&page=${page}&state=${state}`,
  );
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
  const [dialog, setDialog] = useState<"sync" | "file" | null>(null);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const data = query.data;
  function refreshed() {
    query.refresh();
    setDialog(null);
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
        <Button
          variant="ghost"
          disabled={!canWrite}
          onClick={() => setDialog("sync")}
        >
          <CloudDownload size={17} />
          Actualizar compras
        </Button>
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
      {data?.syncFailed && (
        <Notice>
          La actualización automática no pudo terminar. Volveremos a intentarlo;
          tus compras anteriores se conservan. También puedes pulsar Actualizar
          compras.
        </Notice>
      )}
      {data?.syncing && (
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
              <ul className="sire-purchase-list">
                {data.items.map((row) => (
                  <li key={row.id}>
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
      {dialog === "sync" && (
        <SireAutomaticDialog
          month={month}
          initialBook="purchases"
          lockBook
          close={() => setDialog(null)}
          manual={() => setDialog("file")}
          done={(result) => {
            setNotice(
              `${result.count} comprobantes consultados. Los nuevos quedan en esta bandeja y los ya guardados se reconocen sin repetirlos.`,
            );
            refreshed();
          }}
        />
      )}
      {dialog === "file" && (
        <SireFileDialog
          month={month}
          initialBook="purchases"
          lockBook
          close={() => setDialog(null)}
          done={refreshed}
        />
      )}
      {selected && (
        <SirePurchaseDialog
          id={selected}
          canWrite={canWrite}
          close={() => setSelected("")}
          saved={() => {
            setSelected("");
            setNotice("Compra guardada. Ya puedes verla en Compras guardadas.");
            query.refresh();
            onSaved();
          }}
        />
      )}
    </section>
  );
}
