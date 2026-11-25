import { useEffect, useRef, useState } from "react";
import type { SireComparison } from "@veca/content";
import { api, ApiError } from "../../lib/api";
import { accountingPath } from "./accounting-shared";

type Operation = {
  month: string;
  since: string;
  job?: string;
  abort: AbortController;
};

/** Keep a one-click refresh running without blocking the purchase inbox. */
export function useSirePurchaseRefresh(
  month: string,
  completed: (since: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<Operation | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const running = useRef(false);
  const done = useRef(completed);
  done.current = completed;

  useEffect(() => {
    setBusy(false);
    setError("");
    return () => {
      operation.current?.abort.abort();
      operation.current = undefined;
      clearTimeout(timer.current);
      running.current = false;
    };
  }, [month]);

  async function advance(current: Operation) {
    const path = `${accountingPath}/period/${current.month}/reconcile/purchases/automatic`;
    try {
      const next = await api<SireComparison>(
        current.job ? `${path}/${encodeURIComponent(current.job)}` : path,
        {
          method: current.job ? "GET" : "POST",
          signal: AbortSignal.any([
            current.abort.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      );
      if (current.abort.signal.aborted) return;
      if (next.status === "pending") {
        current.job = next.job;
        timer.current = setTimeout(() => void advance(current), 3000);
        return;
      }
      if (!next.result)
        throw new Error(
          "SUNAT no devolvió una consulta completa. Inténtalo de nuevo.",
        );
      operation.current = undefined;
      running.current = false;
      setBusy(false);
      done.current(current.since);
    } catch (cause) {
      if (current.abort.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 400)
        current.job = undefined;
      running.current = false;
      setBusy(false);
      setError(
        cause instanceof Error && cause.name === "TimeoutError"
          ? "La consulta está tardando demasiado. Tus compras se conservan."
          : (cause as Error).message,
      );
    }
  }

  function refresh(since: string) {
    if (running.current) return;
    const current = operation.current ?? {
      month,
      since,
      abort: new AbortController(),
    };
    operation.current = current;
    running.current = true;
    setBusy(true);
    setError("");
    void advance(current);
  }
  return { busy, error, refresh };
}
