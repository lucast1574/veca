import { useState } from "react";
import { ReceiptText } from "lucide-react";
import { Button, Notice } from "../../components/ui";
import {
  accountingPost,
  useAccountingQuery,
} from "../accounting/accounting-shared";

export function WorkInvoiceRequest({ id }: { id: string }) {
  const path = `/admin/crm/leads/${id}/invoice-request`;
  const query = useAccountingQuery<{ requested: boolean }>(path);
  const [accepted, setAccepted] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requested = accepted ?? query.data?.requested;

  async function send() {
    setBusy(true);
    setError("");
    try {
      const response = await accountingPost<{ requested: boolean }>(path, {});
      setAccepted(response.requested);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {requested ? (
        <p className="hint" role="status">
          Factura solicitada a Contabilidad.
        </p>
      ) : (
        <Button
          type="button"
          variant="ghost"
          disabled={busy || query.loading || Boolean(query.error)}
          onClick={() => void send()}
        >
          <ReceiptText size={16} />
          {busy ? "Enviando…" : "Solicitar factura"}
        </Button>
      )}
      {(error || query.error) && (
        <Notice error>
          {error || query.error}
          {query.error && (
            <Button variant="ghost" onClick={query.refresh}>
              Reintentar
            </Button>
          )}
        </Notice>
      )}
    </div>
  );
}
