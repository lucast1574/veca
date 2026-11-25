import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";

export const accountingPath = "/admin/accounting";
export const inquiryTimeout = () => AbortSignal.timeout(12_000);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const amount = (cents: number) =>
  Number.isFinite(cents)
    ? new Intl.NumberFormat("es-PE", {
        style: "currency",
        currency: "PEN",
      }).format(cents / 100)
    : "—";
export const sireDocumentLabel = (type: string) =>
  ({
    "01": "Factura",
    "03": "Boleta",
    "07": "Nota de crédito",
    "08": "Nota de débito",
  })[type] || "Comprobante";
export function displayDate(value: string) {
  const date = new Date(value + "T12:00:00Z");
  return Number.isNaN(date.getTime())
    ? "Fecha por revisar"
    : new Intl.DateTimeFormat("es-PE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
export const decimal = (value: string, digits = 2) => {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(normalized))
    return Number.NaN;
  return Math.round(Number(normalized) * 10 ** digits);
};

export function recordId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export const accountingPost = <T,>(path: string, data: unknown) =>
  api<T>(path, {
    method: "POST",
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(25_000),
  });

export function useAccountingQuery<T>(path: string) {
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((count) => count + 1), []);
  const [result, setResult] = useState<{
    path: string;
    attempt: number;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    if (!path) return;
    const cancelled = new AbortController();
    const deadline = inquiryTimeout();
    void api<T>(path, { signal: AbortSignal.any([cancelled.signal, deadline]) })
      .then((data) => {
        if (data && typeof data === "object" && "message" in data)
          throw new Error(String(data.message));
        if (!cancelled.signal.aborted) setResult({ data, path, attempt });
      })
      .catch((error: Error) => {
        if (cancelled.signal.aborted) return;
        setResult((previous) => ({
          path,
          attempt,
          data: previous?.path === path ? previous.data : undefined,
          error: deadline.aborted
            ? "La consulta tardó demasiado. Vuelve a intentarlo."
            : error.message,
        }));
      });
    return () => cancelled.abort();
  }, [path, attempt]);
  const match = result?.path === path ? result : undefined;
  return {
    data: match?.data,
    error: match?.attempt === attempt ? match?.error : undefined,
    loading: Boolean(path) && match?.attempt !== attempt,
    refresh,
  };
}

export function Refresh({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="accounting-refresh"
      type="button"
      title="Recargar datos"
      aria-label="Recargar datos"
      disabled={loading}
      onClick={onClick}
    >
      <RefreshCw size={17} />
    </button>
  );
}

export function QueryState({
  loading,
  error,
  refresh,
  empty,
  children,
}: {
  loading: boolean;
  error?: string;
  refresh: () => void;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <>
      {loading && !children && (
        <p className="accounting-empty" role="status">
          Cargando datos…
        </p>
      )}
      {error && (
        <div className="accounting-retry">
          <Notice error>{error}</Notice>
          <Button variant="ghost" onClick={refresh}>
            Reintentar
          </Button>
        </div>
      )}
      {!loading && !error && empty && !children && (
        <p className="accounting-empty">{empty}</p>
      )}
      {children}
    </>
  );
}

export function Pagination({
  page,
  hasMore,
  change,
}: {
  page: number;
  hasMore: boolean;
  change: (next: number) => void;
}) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav className="accounting-pagination" aria-label="Paginación">
      <Button
        variant="ghost"
        disabled={page === 1}
        onClick={() => change(page - 1)}
      >
        Anterior
      </Button>
      <span>Página {page}</span>
      <Button
        variant="ghost"
        disabled={!hasMore}
        onClick={() => change(page + 1)}
      >
        Siguiente
      </Button>
    </nav>
  );
}
