import { useState } from "react";
import type { FiscalOverview } from "@veca/content";
import { ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { Button, Notice } from "../../components/ui";

const messages: Record<FiscalOverview["status"], string> = {
  ready: "Emisor habilitado y series verificadas.",
  missingKey: "Falta configurar la credencial de producción.",
  wrongKeyMode: "La credencial configurada no corresponde a producción.",
  invalidIssuer: "El proveedor no confirmó el emisor configurado de VECA.",
  unreachable: "El proveedor fiscal tardó demasiado o no respondió.",
  issuerLookupFailed: "El proveedor no permitió consultar el emisor.",
  seriesLookupFailed: "No se pudieron consultar las series.",
  notEnabled: "El emisor requiere completar su habilitación en producción.",
  missingSeries: "Faltan series activas para facturas o guías de remisión.",
};

export function FiscalConnection() {
  const [result, setResult] = useState<FiscalOverview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api<FiscalOverview>("/admin/administration/fiscal", {
          signal: AbortSignal.timeout(18_000),
        }),
      );
    } catch (error) {
      setResult(undefined);
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="administration-section"
      aria-labelledby="administration-fiscal"
    >
      <div className="administration-section-heading">
        <h2 id="administration-fiscal">Emisión electrónica</h2>
      </div>
      <article className="administration-card">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void check()}
        >
          <ShieldCheck size={16} />{" "}
          {busy ? "Comprobando…" : "Comprobar conexión fiscal"}
        </Button>
        {error && <Notice error>{error}</Notice>}
        {result && (
          <>
            <p role="status">
              {messages[result.status]}
              {result.http ? ` HTTP ${result.http}.` : ""}
            </p>
            {result.status === "notEnabled" && (
              <p className="hint">
                {[
                  !result.active && "Emisor inactivo",
                  !result.credentials && "Credenciales del emisor incompletas",
                  !result.certificate && "Certificado pendiente",
                  result.certificateExpired && "Certificado vencido",
                  !result.validated && "Validación pendiente",
                  !result.productionEnabled && "Producción deshabilitada",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {result.invoiceSeries && (
              <p>
                Facturas {result.invoiceSeries.join(", ") || "sin serie"} ·
                Guías {result.guideSeries?.join(", ") || "sin serie"}
              </p>
            )}
            {result.cleanup.deleted && (
              <p className="hint">
                Demostración eliminada · {result.cleanup.deleted.leads} leads ·{" "}
                {result.cleanup.deleted.dispatches} despachos ·{" "}
                {result.cleanup.deleted.files} adjuntos ·{" "}
                {result.cleanup.deleted.invoices} facturas de prueba.
              </p>
            )}
            {Object.values(result.cleanup.remaining).some(Boolean) && (
              <p className="hint">
                Datos de ejemplo restantes · {result.cleanup.remaining.leads}{" "}
                leads · {result.cleanup.remaining.dispatches} despachos ·{" "}
                {result.cleanup.remaining.invoices} facturas.
              </p>
            )}
          </>
        )}
      </article>
    </section>
  );
}
