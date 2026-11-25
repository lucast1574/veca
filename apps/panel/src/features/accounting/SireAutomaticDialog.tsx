import { useEffect, useRef, useState } from "react";
import { CloudDownload, FileUp, ShieldCheck } from "lucide-react";
import type {
  SireBook,
  SireComparison,
  SireReconciliation,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { WarehouseSelect } from "../warehouse/shared";
import { accountingPath, useAccountingQuery } from "./accounting-shared";

export function SireAutomaticDialog({
  month,
  close,
  manual,
  done,
  initialBook = "purchases",
  lockBook = false,
}: {
  month: string;
  initialBook?: SireBook;
  lockBook?: boolean;
  close: () => void;
  manual: () => void;
  done: (result: SireReconciliation) => void;
}) {
  const connection = useAccountingQuery<{ configured: boolean }>(
    accountingPath + "/sire/connection",
  );
  const [book, setBook] = useState<SireBook>(initialBook);
  const [job, setJob] = useState<SireComparison>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const request = useRef<AbortController | null>(null);
  const completed = useRef(done);
  completed.current = done;
  const path = `${accountingPath}/period/${month}/reconcile/${book}/automatic`;
  const processing = busy || (job?.status === "pending" && !paused);
  useEffect(() => () => request.current?.abort(), []);
  function receive(next: SireComparison) {
    if (next.status === "ready") {
      if (next.result) completed.current(next.result);
      else {
        setError("No recibimos una comparación completa. Vuelve a consultar.");
        setPaused(true);
      }
    } else setJob(next);
  }
  useEffect(() => {
    if (!job || job.status !== "pending" || paused) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api<SireComparison>(path + "/" + encodeURIComponent(job.job), {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
      })
        .then(receive)
        .catch((error: Error) => {
          if (!abort.signal.aborted) {
            setError(error.message);
            setPaused(true);
          }
        });
    }, 3000);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [job, paused, path]);
  async function start() {
    if (processing) return;
    setError("");
    if (job?.status === "pending") {
      setPaused(false);
      return;
    }
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    try {
      receive(
        await api<SireComparison>(path, {
          method: "POST",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
        }),
      );
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal
      title={
        book === "purchases"
          ? "Comparar compras con SUNAT"
          : "Comparar ventas con SUNAT"
      }
      description={
        book === "purchases"
          ? `Revisaremos si las compras de ${month} coinciden con lo guardado en VECA.`
          : `Compararemos las ventas de ${month} con las facturas de VECA.`
      }
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={close}>
            Cerrar
          </Button>
          <Button
            type="button"
            disabled={processing || !connection.data?.configured}
            onClick={() => void start()}
          >
            {processing
              ? "Consultando SUNAT…"
              : error
                ? "Reintentar consulta"
                : book === "purchases"
                  ? "Comparar compras"
                  : "Comparar ventas"}
          </Button>
        </footer>
      }
    >
      <div className="sire-automatic">
        <div className="sire-connect-intro">
          <span>
            <CloudDownload size={24} />
          </span>
          <div>
            <h3>
              {book === "purchases"
                ? "Comprueba lo que está guardado"
                : "Comprueba tus ventas"}
            </h3>
            <p>
              {book === "purchases"
                ? "Verás qué comprobantes coinciden, cuáles tienen un importe distinto y cuáles aparecen solo en SUNAT o solo en VECA. Las compras nuevas también llegarán a tu bandeja, sin duplicar las ya guardadas."
                : "Verás si las facturas de venta de VECA coinciden con lo que aparece en SUNAT y cuáles necesitan revisión."}
            </p>
          </div>
        </div>
        {!lockBook && (
          <fieldset disabled={processing} className="warehouse-fields">
            <WarehouseSelect
              label="Registro"
              value={book}
              onChange={(value) => {
                setBook(value as SireBook);
                setJob(undefined);
                setError("");
                setPaused(false);
              }}
              options={[
                { value: "purchases", label: "Compras (RCE)" },
                { value: "sales", label: "Ventas (RVIE)" },
              ]}
            />
          </fieldset>
        )}
        {connection.loading && (
          <p className="hint" role="status">
            Comprobando conexión…
          </p>
        )}
        {connection.error && (
          <div className="sire-connection-error">
            <Notice error>No pudimos comprobar la conexión con SUNAT.</Notice>
            <Button type="button" variant="ghost" onClick={connection.refresh}>
              Comprobar otra vez
            </Button>
          </div>
        )}
        {connection.data?.configured === false && (
          <Notice>
            La conexión necesita atención. Pide a Administración que revise el
            acceso a SUNAT.
          </Notice>
        )}
        {processing && (
          <div className="sire-query-status" role="status">
            <CloudDownload size={20} />
            <div>
              <strong>
                {job
                  ? "SUNAT está preparando la propuesta"
                  : "Conectando con SUNAT"}
              </strong>
              <p>
                Los resultados quedarán en tu bandeja cuando termine la consulta
                automática. Puedes cerrar esta ventana.
              </p>
            </div>
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
        <p className="sire-readonly">
          <ShieldCheck size={16} />
          <span>
            Esta consulta no declara impuestos ni acepta registros de SUNAT.
          </span>
        </p>
        <button type="button" className="sire-manual-option" onClick={manual}>
          <FileUp size={18} />
          <span>
            <strong>Ya tengo un archivo TXT</strong>
            <small>Cargar las compras o ventas desde un archivo de SUNAT</small>
          </span>
        </button>
      </div>
    </Modal>
  );
}
