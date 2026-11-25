import { useId, useState, type FormEvent } from "react";
import { Check, Package, ReceiptText } from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import {
  sireIncorporation,
  type AccountingWork,
  type SirePurchase,
  type SireIncorporation,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import {
  accountingPath,
  accountingPost,
  amount,
  displayDate,
  sireDocumentLabel,
  QueryState,
  useAccountingQuery,
} from "./accounting-shared";

type Detail = {
  item: SirePurchase;
  purchases: { id: string; label: string; referenceMatch: boolean }[];
};
export function SirePurchaseDialog({
  id,
  close,
  saved,
  canWrite,
}: {
  id: string;
  close: () => void;
  saved: () => void;
  canWrite: boolean;
}) {
  const query = useAccountingQuery<Detail>(
    `${accountingPath}/sire/purchases/${id}`,
  );
  if (!query.data)
    return (
      <Modal title="Revisar compra" onClose={close}>
        <QueryState {...query} />
      </Modal>
    );
  return (
    <PurchaseForm
      key={id}
      detail={query.data}
      close={close}
      saved={saved}
      canWrite={canWrite}
    />
  );
}
function PurchaseForm({
  detail: { item, purchases },
  close,
  saved,
  canWrite,
}: {
  detail: Detail;
  close: () => void;
  saved: () => void;
  canWrite: boolean;
}) {
  const formId = useId();
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const suggested = purchases.filter((p) => p.referenceMatch);
  const [destination, setDestination] = useState<
    SireIncorporation["destination"] | ""
  >(suggested.length === 1 ? "warehouse" : "");
  const [kind, setKind] = useState("");
  const [workId, setWork] = useState("");
  const [purchaseId, setPurchase] = useState(
    suggested.length === 1 ? suggested[0].id : "",
  );
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useUnsavedChanges(dirty, busy);
  const onClose = () => {
    if (confirmDiscard(dirty, busy)) close();
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !canWrite) return;
    const result = sireIncorporation.safeParse({
      version: item.version,
      description,
      destination,
      kind: destination === "warehouse" ? "other" : kind,
      ...(destination === "work" && workId && { workId }),
      ...(destination === "warehouse" && purchaseId && { purchaseId }),
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await accountingPost(
        `${accountingPath}/sire/purchases/${item.id}/incorporate`,
        result.data,
      );
      setDirty(false);
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Completar esta compra"
      description="Los datos del comprobante ya están listos. Solo indica para qué fue la compra."
      onClose={onClose}
      busy={busy}
      size="wide"
      footer={
        <footer className="ve-modal-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={!canWrite || busy || item.status !== "pending"}
          >
            <Check size={16} />
            {busy ? "Guardando…" : "Guardar compra en VECA"}
          </Button>
        </footer>
      }
    >
      <div className="sire-purchase-receipt">
        <ReceiptText size={22} />
        <div>
          <strong>{item.supplier || "Proveedor sin nombre"}</strong>
          <span>
            {sireDocumentLabel(item.type)} {item.reference} ·{" "}
            {displayDate(item.date)}
          </span>
          <small>RUC {item.taxId}</small>
        </div>
        <b>
          {item.currency === "PEN"
            ? amount(item.total)
            : `${item.currency} ${(item.total / 100).toFixed(2)}`}
        </b>
      </div>
      {item.status !== "pending" ? (
        <Notice>
          {item.status === "registered"
            ? "Esta factura ya está guardada en VECA. No se creará otra."
            : item.reason ||
              "Los importes difieren del registro de VECA. Contabilidad debe revisar la diferencia antes de continuar."}
        </Notice>
      ) : (
        <form
          id={formId}
          onSubmit={submit}
          onChange={() => setDirty(true)}
          className="sire-purchase-form"
        >
          <fieldset disabled={busy || !canWrite} className="warehouse-fields">
            <Field label="¿Para qué fue esta compra?">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={3}
                maxLength={200}
                placeholder="Por ejemplo: combustible para llevar materiales"
              />
            </Field>
            <Field label="¿A dónde corresponde?">
              <Select
                label="Destino de la compra"
                value={destination}
                options={[
                  { value: "", label: "Selecciona un destino" },
                  { value: "general", label: "Gasto de la empresa" },
                  { value: "work", label: "Gasto de una obra" },
                  {
                    value: "warehouse",
                    label: "Compra de materiales para almacén",
                  },
                ]}
                onChange={(value) => {
                  setDestination(value as typeof destination);
                  setDirty(true);
                }}
              />
            </Field>
            {destination && destination !== "warehouse" && (
              <Field label="Tipo de gasto">
                <Select
                  label="Tipo de gasto"
                  value={kind}
                  options={[
                    { value: "", label: "Selecciona el tipo" },
                    { value: "fuel", label: "Combustible" },
                    { value: "transport", label: "Transporte" },
                    { value: "installation", label: "Instalación" },
                    { value: "other", label: "Otro gasto" },
                  ]}
                  onChange={(value) => {
                    setKind(value);
                    setDirty(true);
                  }}
                />
              </Field>
            )}
            {destination === "work" && (
              <>
                <Field label="Obra">
                  <Select
                    label="Obra"
                    value={workId}
                    options={[
                      { value: "", label: "Selecciona la obra" },
                      ...(works.data || []).map((work) => ({
                        value: work.id,
                        label: work.name,
                      })),
                    ]}
                    onChange={(value) => {
                      setWork(value);
                      setDirty(true);
                    }}
                  />
                </Field>
                {works.error && <Notice error>{works.error}</Notice>}
              </>
            )}
            {destination === "warehouse" && (
              <div className="sire-destination">
                <Package size={20} />
                <div>
                  <p>
                    Vincula la factura con una compra de Inventario. Se guardará
                    su comprobante sin crear otra orden ni sumar materiales al
                    stock.
                  </p>
                  <Field label="Compra de Inventario">
                    <Select
                      label="Compra de Inventario"
                      value={purchaseId}
                      options={[
                        {
                          value: "",
                          label: "Selecciona la compra del proveedor",
                        },
                        ...purchases.map((p) => ({
                          value: p.id,
                          label: `${p.referenceMatch ? "Referencia coincidente · " : ""}${p.label}`,
                        })),
                      ]}
                      onChange={(value) => {
                        setPurchase(value);
                        setDirty(true);
                      }}
                    />
                  </Field>
                  {!purchases.length && (
                    <p className="hint">
                      No hay una compra vigente de este proveedor. Solicita a
                      Almacén registrar la compra en Inventario y vuelve a abrir
                      esta factura.
                    </p>
                  )}
                </div>
              </div>
            )}
          </fieldset>
          <details className="sire-fiscal-details">
            <summary>Ver importes de la factura</summary>
            <dl>
              <div>
                <dt>Importe sin IGV</dt>
                <dd>{amount(item.net)}</dd>
              </div>
              <div>
                <dt>IGV</dt>
                <dd>{amount(item.tax)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{amount(item.total)}</dd>
              </div>
            </dl>
          </details>
          <p className="hint">
            Quedará guardada en Compras y gastos, pendiente de revisión de
            Contabilidad. Este paso no registra un pago.
          </p>
          {error && <Notice error>{error}</Notice>}
        </form>
      )}
    </Modal>
  );
}
