import { useId, useState, type FormEvent } from "react";
import { Check, Package, ReceiptText } from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import {
  AccountingProofField,
  AccountingProofRetry,
  uploadAccountingProof,
} from "./AccountingProof";
import {
  sireIncorporation,
  type AccountingWork,
  COST_KIND_LABELS,
  type CostInput,
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
  initial,
  initialProof,
}: {
  initial?: CostInput;
  initialProof?: File;
  id: string;
  close: () => void;
  saved: (purchaseId?: string) => void;
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
      initial={initial}
      initialProof={initialProof}
    />
  );
}
function PurchaseForm({
  detail: { item, purchases },
  close,
  saved,
  canWrite,
  initial,
  initialProof,
}: {
  initial?: CostInput;
  initialProof?: File;
  detail: Detail;
  close: () => void;
  saved: (purchaseId?: string) => void;
  canWrite: boolean;
}) {
  const formId = useId();
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const suggested = purchases.filter((p) => p.referenceMatch);
  const [destination, setDestination] = useState<
    SireIncorporation["destination"] | ""
  >(
    suggested.length === 1 || initial?.kind === "purchase"
      ? "warehouse"
      : initial?.allocations.length
        ? "work"
        : initial
          ? "general"
          : "",
  );
  const [kind, setKind] = useState(
    initial && !["purchase", "materials"].includes(initial.kind)
      ? initial.kind
      : "",
  );
  const [workId, setWork] = useState(initial?.allocations[0]?.workId || "");
  const [splits, setSplits] = useState(
    initial?.allocations && initial.allocations.length > 1
      ? initial.allocations
      : [],
  );
  const [purchaseId, setPurchase] = useState(
    suggested.length === 1
      ? suggested[0].id
      : purchases.find((purchase) => purchase.id === initial?.purchaseId)?.id ||
          "",
  );
  const [description, setDescription] = useState(initial?.description || "");
  const [dirty, setDirty] = useState(
    Boolean(initial) && item.status === "pending",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(initialProof ?? null);
  const [pendingProof, setPendingProof] = useState<{
    costId: string;
    purchaseId?: string;
    file: File;
    error: string;
  }>();
  useUnsavedChanges(dirty, busy);
  const onClose = () => {
    if (confirmDiscard(dirty, busy)) close();
  };
  const distributed =
    destination !== "work" ||
    splits.length === 0 ||
    splits.reduce((sum, row) => sum + row.cents, 0) === item.net;
  const parsePurchase = () =>
    sireIncorporation.safeParse({
      version: item.version,
      description,
      destination,
      kind: destination === "warehouse" ? "other" : kind,
      ...(destination === "work" &&
        (splits.length ? { allocations: splits } : workId ? { workId } : {})),
      ...(destination === "warehouse" && purchaseId && { purchaseId }),
    });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !canWrite) return;
    if (!distributed) {
      setError(
        "Distribuye todo el importe sin IGV de la factura entre las obras.",
      );
      return;
    }
    const result = parsePurchase();
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const incorporated = await accountingPost<{
        costId: string;
        purchaseId?: string;
      }>(
        `${accountingPath}/sire/purchases/${item.id}/incorporate`,
        result.data,
      );
      setDirty(false);
      if (proofFile) {
        try {
          await uploadAccountingProof(
            `${accountingPath}/costs/${incorporated.costId}`,
            proofFile,
          );
        } catch (error) {
          setPendingProof({
            ...incorporated,
            file: proofFile,
            error: (error as Error).message,
          });
          return;
        }
      }
      saved(incorporated.purchaseId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (pendingProof)
    return (
      <AccountingProofRetry
        initialFile={pendingProof.file}
        initialError={pendingProof.error}
        onUpload={async (file) => {
          await uploadAccountingProof(
            `${accountingPath}/costs/${pendingProof.costId}`,
            file,
          );
          saved(pendingProof.purchaseId);
        }}
        onSkip={() => saved(pendingProof.purchaseId)}
      />
    );
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
            disabled={
              !canWrite ||
              busy ||
              item.status !== "pending" ||
              !distributed ||
              !parsePurchase().success
            }
          >
            <Check size={16} />
            {busy
              ? "Guardando…"
              : destination === "warehouse"
                ? purchaseId
                  ? "Guardar y vincular pedido"
                  : "Guardar y completar materiales"
                : "Guardar compra en VECA"}
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
      {initial &&
        (initial.netCents !== item.net || initial.taxCents !== item.tax) && (
          <Notice>
            Los importes que ingresaste no coinciden con la factura: escribiste{" "}
            {amount(initial.netCents + initial.taxCents)} y SUNAT muestra{" "}
            {amount(item.total)}. Usaremos los importes del comprobante;
            revísalos antes de guardar.
          </Notice>
        )}
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
                    { value: "meals", label: COST_KIND_LABELS.meals },
                    { value: "services", label: COST_KIND_LABELS.services },
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
            {destination === "work" && splits.length > 0 && (
              <div className="accounting-group">
                <h3>Distribución que ingresaste</h3>
                <p className="hint">
                  Conservamos las obras y los importes. Deben sumar el importe
                  sin IGV de SUNAT.
                </p>
                {splits.map((split, index) => (
                  <Field
                    key={split.workId}
                    label={
                      works.data?.find((work) => work.id === split.workId)
                        ?.name || "Obra"
                    }
                  >
                    <input
                      aria-label={`Importe para obra ${index + 1}`}
                      inputMode="decimal"
                      defaultValue={String(split.cents / 100)}
                      onChange={(e) => {
                        const value = e.target.value.replace(",", ".");
                        setSplits((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  cents: /^\d+(\.\d{1,2})?$/.test(value)
                                    ? Math.round(Number(value) * 100)
                                    : 0,
                                }
                              : row,
                          ),
                        );
                        setDirty(true);
                      }}
                    />
                  </Field>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSplits([]);
                    setDirty(true);
                  }}
                >
                  Asignar a una sola obra
                </Button>
              </div>
            )}
            {destination === "work" && !splits.length && (
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
                  {purchases.length > 0 && (
                    <Field label="Detalle de materiales">
                      <Select
                        label="Detalle de materiales"
                        value={purchaseId}
                        options={[
                          {
                            value: "",
                            label: "Completar materiales en el siguiente paso",
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
                  )}
                  <p>
                    {purchaseId
                      ? "Vincularemos esta factura al pedido seleccionado, sin repetir sus materiales."
                      : "En el siguiente paso indicarás los materiales, cantidades y precios. Almacén confirmará lo recibido."}
                  </p>
                </div>
              </div>
            )}
            <AccountingProofField
              file={proofFile}
              onClear={() => setProofFile(null)}
              hint="Foto o PDF de hasta 8 MB. Se requiere al marcar como revisado."
              onSelect={(file) => {
                setProofFile(file);
                setDirty(true);
              }}
            />
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
