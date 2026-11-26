import {
  AccountingPurchaseOrders,
  PurchaseCostDetail,
} from "./AccountingPurchaseOrders";
import { SirePurchaseDialog } from "./SirePurchaseDialog";
import { SirePurchaseInbox } from "./SirePurchaseInbox";
import { SireClosingGuide } from "./SireClosingGuide";
import { useAccountingPermission } from "./AccountingAccess";
import {
  AccountingProofField,
  AccountingProofRetry,
  uploadAccountingProof,
} from "./AccountingProof";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import {
  costInput,
  costKinds,
  COST_KIND_LABELS,
  type AccountingCost,
  type AccountingWork,
  type CostInput,
  type ManualCostCheck,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { API_BASE, api } from "../../lib/api";
import { Button, Field, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import {
  accountingPath,
  amount,
  decimal,
  displayDate,
  Pagination,
  QueryState,
  recordId,
  Refresh,
  today,
  useAccountingQuery,
} from "./accounting-shared";

import "./accounting-costs.css";

const path = accountingPath + "/costs";
type CostPage = { items: AccountingCost[]; hasMore: boolean };

function CostProofStatus({ row }: { row: AccountingCost }) {
  return (
    <span
      className="cost-proof-status"
      data-state={row.proof ? "attached" : "missing"}
    >
      {row.proof ? "Con sustento" : "Falta sustento"}
    </span>
  );
}

export function AccountingCosts({
  purchaseId,
  inventoryAccess,
  preparePurchase = false,
  initialMonth,
}: {
  preparePurchase?: boolean;
  purchaseId?: string;
  inventoryAccess: boolean;
  initialMonth?: string;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(initialMonth || today().slice(0, 7));
  const query = useAccountingQuery<CostPage>(
    `${path}?page=${page}${month ? `&month=${month}` : ""}${purchaseId ? `&purchase=${encodeURIComponent(purchaseId)}` : ""}`,
  );
  const [entry, setEntry] = useState<"new" | AccountingCost>();
  const [active, setActive] = useState<AccountingCost>();
  const [inboxRevision, setInboxRevision] = useState(0);
  const [preparing, setPreparing] = useState<string | undefined>(
    preparePurchase ? purchaseId : undefined,
  );
  const [source, setSource] = useState<{
    id: string;
    initial: CostInput;
    proof?: File;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = query.data?.items || [];

  async function attachProof(file: File) {
    if (!active || busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await uploadAccountingProof<AccountingCost>(
        `${path}/${active.id}`,
        file,
      );
      setActive(result);
      query.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="accounting-costs">
      <div className="accounting-section-head">
        <h2 id="accounting-costs">Compras y gastos</h2>
        <div className="accounting-tools">
          <Refresh loading={query.loading} onClick={query.refresh} />
          <Button disabled={!canWrite} onClick={() => setEntry("new")}>
            <Plus size={16} /> Registrar gasto o compra
          </Button>
        </div>
      </div>
      <p className="hint">
        Registra los comprobantes, los materiales comprados y sus precios.
        Almacén confirma las cantidades recibidas en Inventario.
      </p>
      {purchaseId && (
        <p className="hint">
          Mostrando los comprobantes del pedido seleccionado.{" "}
          <a className="accounting-inline" href="#accounting/gastos">
            Ver todos los gastos
          </a>
          {inventoryAccess && (
            <>
              {" "}
              ·{" "}
              <a
                className="accounting-inline"
                href={`#inventory/compras/${purchaseId}`}
              >
                Ver pedido y recepciones
              </a>
            </>
          )}
        </p>
      )}
      <div className="accounting-filters">
        <Field label="Filtrar por periodo">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setPage(1);
              setMonth(e.target.value);
            }}
          />
        </Field>
      </div>
      {!purchaseId && month && (
        <SirePurchaseInbox
          month={month}
          key={`sire-inbox:${month}`}
          revision={inboxRevision}
          onSaved={(orderId) => {
            query.refresh();
            setInboxRevision((value) => value + 1);
            if (orderId) setPreparing(orderId);
          }}
        />
      )}
      <AccountingPurchaseOrders
        canWrite={canWrite}
        purchaseId={purchaseId}
        selected={preparing}
        onSelect={setPreparing}
        revision={inboxRevision}
        onClose={() => {
          setPreparing(undefined);
          if (preparePurchase)
            location.hash = `accounting/gastos/${purchaseId}`;
        }}
        onSaved={() => {
          setInboxRevision((value) => value + 1);
          query.refresh();
        }}
      />
      <section className="saved-costs" aria-labelledby="saved-costs-heading">
        <h3 id="saved-costs-heading">Compras y gastos guardados</h3>
        <QueryState
          {...query}
          empty="Todavía no hay compras ni gastos guardados en este periodo."
        >
          {rows.length > 0 && (
            <ul className="saved-cost-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <div className="saved-cost-label">
                    <strong>{row.description}</strong>
                    <small>
                      {COST_KIND_LABELS[row.kind]} · {displayDate(row.date)}
                    </small>
                  </div>
                  <div className="saved-cost-meta">
                    <strong className="saved-cost-total">
                      {amount(row.netCents + row.taxCents)}
                    </strong>
                    <CostProofStatus row={row} />
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError("");
                      setActive(row);
                    }}
                  >
                    Ver detalle <ChevronRight size={14} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        <Pagination
          page={page}
          hasMore={Boolean(query.data?.hasMore)}
          change={setPage}
        />
      </section>
      {!purchaseId && month && (
        <SireClosingGuide key={`sire-closing:${month}`} month={month} />
      )}
      {entry && (
        <CostForm
          current={entry === "new" ? undefined : entry}
          initialPurchase={purchaseId}
          onClose={() => setEntry(undefined)}
          onFound={async (match, initial, proof) => {
            setEntry(undefined);
            if (match.status === "found") {
              setMonth(match.period);
              setSource({ id: match.purchaseId, initial, proof });
            } else {
              try {
                let row = await api<AccountingCost>(`${path}/${match.costId}`);
                setError("");
                if (proof && !row.proof) {
                  try {
                    row = await uploadAccountingProof<AccountingCost>(
                      `${path}/${row.id}`,
                      proof,
                    );
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }
                setMonth(row.date.slice(0, 7));
                setActive(row);
              } catch (e) {
                setError((e as Error).message);
              }
            }
            query.refresh();
          }}
          onSaved={(row) => {
            setEntry(undefined);
            if (row.kind === "purchase" && row.purchaseId && entry === "new")
              setPreparing(row.purchaseId);
            else setActive(row);
            setInboxRevision((value) => value + 1);
            setPage(1);
            query.refresh();
          }}
        />
      )}
      {source && (
        <SirePurchaseDialog
          id={source.id}
          initial={source.initial}
          initialProof={source.proof}
          canWrite={canWrite}
          close={() => setSource(undefined)}
          saved={(orderId) => {
            setSource(undefined);
            if (orderId) setPreparing(orderId);
            setInboxRevision((value) => value + 1);
            query.refresh();
          }}
        />
      )}
      {error && !active && <Notice error>{error}</Notice>}
      {active && (
        <Modal
          title={active.description}
          description={`${COST_KIND_LABELS[active.kind]} · ${displayDate(active.date)}`}
          busy={busy}
          onClose={() => setActive(undefined)}
          footer={
            canWrite &&
            !active.reviewed && (
              <footer className="ve-modal-actions">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEntry(active);
                    setActive(undefined);
                  }}
                >
                  Editar registro
                </Button>
              </footer>
            )
          }
        >
          <div className="cost-detail">
            <dl className="cost-detail-facts">
              <div className="cost-detail-total">
                <dt>Total</dt>
                <dd>{amount(active.netCents + active.taxCents)}</dd>
              </div>
              {active.reference && (
                <div>
                  <dt>Comprobante</dt>
                  <dd>{active.reference}</dd>
                </div>
              )}
              {active.supplier && (
                <div>
                  <dt>Proveedor</dt>
                  <dd>{active.supplier}</dd>
                </div>
              )}
              {active.supplierRuc && (
                <div>
                  <dt>RUC</dt>
                  <dd>{active.supplierRuc}</dd>
                </div>
              )}
              {(!active.purchaseId || active.allocations.length > 0) && (
                <div>
                  <dt>Asignación del gasto</dt>
                  <dd>
                    {active.allocations.length
                      ? `${active.allocations.length} ${active.allocations.length === 1 ? "obra" : "obras"}`
                      : "Gasto general"}
                  </dd>
                </div>
              )}
            </dl>
            {active.purchaseId && (
              <PurchaseCostDetail
                id={active.purchaseId}
                inventoryAccess={inventoryAccess}
              />
            )}
            {active.dispatchId && (
              <RelatedCost
                label="Despacho asociado"
                id={active.dispatchId}
                name="dispatches"
              />
            )}
            <section className="cost-detail-support">
              <header>
                <h3>Sustento</h3>
                <span role="status">
                  <CostProofStatus row={active} />
                </span>
              </header>
              {active.proof ? (
                <a
                  className="accounting-inline cost-detail-proof"
                  href={`${API_BASE}${path}/${active.id}/proof`}
                >
                  <Download size={15} aria-hidden="true" /> Descargar sustento
                </a>
              ) : (
                canWrite && (
                  <AccountingProofField
                    file={null}
                    optionalAtSave={false}
                    hint="Foto o PDF de hasta 8 MB."
                    disabled={busy}
                    onSelect={(file) => void attachProof(file)}
                  />
                )
              )}
              {error && <Notice error>{error}</Notice>}
            </section>
          </div>
        </Modal>
      )}
    </section>
  );
}

type OriginList = Record<
  "purchases" | "dispatches",
  { value: string; label: string }[]
>;

function RelatedCost({
  label,
  id,
  name,
}: {
  label: string;
  id: string;
  name: keyof OriginList;
}) {
  const query = useAccountingQuery<OriginList>(
    accountingPath + "/cost-origins",
  );
  const target = query.data?.[name].find((item) => item.value === id);
  return (
    <p>
      <strong>{label}</strong> · {target?.label || id.slice(-8)}
    </p>
  );
}

function CostForm({
  initialPurchase,
  current,
  onClose,
  onSaved,
  onFound,
}: {
  onFound: (
    match: Extract<ManualCostCheck, { status: "found" | "registered" }>,
    initial: CostInput,
    proof?: File,
  ) => void;
  current?: AccountingCost;
  initialPurchase?: string;
  onClose: () => void;
  onSaved: (row: AccountingCost) => void;
}) {
  const query = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [kind, setKind] = useState<CostInput["kind"]>(
    current?.kind || (initialPurchase ? "purchase" : "other"),
  );
  const origins = useAccountingQuery<OriginList>(
    accountingPath + "/cost-origins",
  );
  const [purchaseId, setPurchase] = useState(
    current?.purchaseId || initialPurchase || "",
  );
  const [dispatchId, setDispatch] = useState(current?.dispatchId || "");
  const [net, setNet] = useState(current ? String(current.netCents / 100) : "");
  const [splits, setSplits] = useState(() =>
    (current?.allocations || []).map((row) => ({
      id: crypto.randomUUID(),
      workId: row.workId,
      amount: String(row.cents / 100),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty, busy);
  const close = () => {
    if (confirmDiscard(dirty, busy)) onClose();
  };
  const [error, setError] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [pendingProof, setPendingProof] = useState<{
    record: AccountingCost;
    file: File;
    error: string;
  }>();
  const id = useRef(recordId());
  const [match, setMatch] =
    useState<Extract<ManualCostCheck, { status: "found" | "registered" }>>();
  const matchNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (match) matchNotice.current?.focus();
  }, [match]);
  const draft = useRef<CostInput | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const parseCost = (fields: FormData) =>
    costInput.safeParse({
      description: fields.get("description"),
      date: fields.get("date"),
      supplier: fields.get("supplier"),
      supplierRuc: fields.get("supplierRuc"),
      reference: fields.get("reference"),
      ...(purchaseId && kind !== "materials" ? { purchaseId } : {}),
      ...(dispatchId ? { dispatchId } : {}),
      kind,
      netCents: decimal(net),
      taxCents:
        kind === "materials" ? 0 : decimal(String(fields.get("tax") || "")),
      allocations: splits.map((item) => ({
        workId: item.workId,
        cents: decimal(item.amount),
      })),
    });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const dto = parseCost(new FormData(event.currentTarget));
    if (!dto.success) {
      setError(dto.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      let saved: AccountingCost | undefined;
      if (current)
        saved = await api<AccountingCost>(`${path}/${current.id}`, {
          method: "PUT",
          body: JSON.stringify({ version: current.version, data: dto.data }),
        });
      else {
        const abort = new AbortController();
        request.current = abort;
        const deadline = AbortSignal.timeout(35_000);
        for (let attempt = 0; attempt < 10; attempt++) {
          const response = await api<
            AccountingCost | { check: ManualCostCheck }
          >(path, {
            method: "POST",
            body: JSON.stringify({ id: id.current, data: dto.data }),
            signal: AbortSignal.any([abort.signal, deadline]),
          });
          if (!("check" in response)) {
            saved = response;
            break;
          }
          if (
            response.check.status === "found" ||
            response.check.status === "registered"
          ) {
            draft.current = dto.data;
            setMatch(response.check);
            return;
          }
          if (response.check.status !== "pending")
            throw new Error(
              "No pudimos comprobar la factura. Vuelve a intentarlo.",
            );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (abort.signal.aborted) return;
        }
        if (!saved)
          throw new Error(
            "SUNAT está tardando en responder. Conservamos tus datos; vuelve a pulsar Guardar registro para continuar la comprobación.",
          );
      }
      if (proofFile && !saved.proof) {
        try {
          saved = await uploadAccountingProof<AccountingCost>(
            `${path}/${saved.id}`,
            proofFile,
          );
        } catch (error) {
          setDirty(false);
          setPendingProof({
            record: saved,
            file: proofFile,
            error: (error as Error).message,
          });
          return;
        }
      }
      onSaved(saved);
    } catch (e) {
      setError(
        (e as Error).name === "TimeoutError"
          ? "La consulta tardó demasiado. Tus datos se conservan; vuelve a intentarlo."
          : (e as Error).message,
      );
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
          onSaved(
            await uploadAccountingProof<AccountingCost>(
              `${path}/${pendingProof.record.id}`,
              file,
            ),
          );
        }}
        onSkip={() => onSaved(pendingProof.record)}
      />
    );
  return (
    <Modal
      title={current ? "Editar gasto o compra" : "Registrar gasto o compra"}
      size="wide"
      busy={busy}
      onClose={close}
    >
      {match && (
        <div
          className="sire-help-copy manual-match-notice"
          ref={matchNotice}
          tabIndex={-1}
          role="status"
        >
          <h3>
            {match.status === "found"
              ? "Encontramos esta factura en SUNAT"
              : "Esta factura ya está guardada en VECA"}
          </h3>
          <p>
            {match.status === "found"
              ? "Usaremos los datos del proveedor para evitar registrar la compra dos veces. Conservamos el concepto, la categoría y la asignación que ingresaste."
              : "Abre el registro existente para revisarlo. No crearemos otra compra."}
          </p>
          <div className="ve-modal-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMatch(undefined)}
            >
              Volver al formulario
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (draft.current) {
                  setDirty(false);
                  onFound(match, draft.current, proofFile ?? undefined);
                }
              }}
            >
              {match.status === "found"
                ? "Continuar con esta factura"
                : proofFile
                  ? "Abrir y adjuntar sustento"
                  : "Abrir compra guardada"}
            </Button>
          </div>
        </div>
      )}
      <form
        hidden={Boolean(match)}
        onSubmit={save}
        onChange={() => setDirty(true)}
      >
        <fieldset disabled={busy} className="accounting-form-fields">
          <div className="accounting-grid">
            <Field label="Concepto">
              <input
                required
                name="description"
                maxLength={200}
                defaultValue={current?.description}
              />
            </Field>
            <Field label="Categoría">
              <Select
                label="Categoría"
                value={kind}
                options={costKinds.map((value) => ({
                  value,
                  label: COST_KIND_LABELS[value],
                }))}
                onChange={(value) => {
                  setKind(value as CostInput["kind"]);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Fecha">
              <input
                type="date"
                name="date"
                required
                defaultValue={current?.date || today()}
              />
            </Field>
            <Field label="Proveedor">
              <input
                name="supplier"
                required={kind === "purchase"}
                maxLength={150}
                defaultValue={current?.supplier}
              />
            </Field>
            <Field label="RUC del proveedor">
              <input
                name="supplierRuc"
                defaultValue={current?.supplierRuc}
                inputMode="numeric"
                pattern="[0-9]{11}"
                maxLength={11}
              />
            </Field>
            <Field label="Número de comprobante">
              <input
                name="reference"
                maxLength={80}
                defaultValue={current?.reference}
              />
            </Field>
            <Field label="Importe sin IGV">
              <input
                required
                inputMode="decimal"
                value={net}
                onChange={(e) => setNet(e.target.value)}
              />
            </Field>
            {kind !== "materials" && (
              <Field label="IGV del comprobante">
                <input
                  name="tax"
                  inputMode="decimal"
                  defaultValue={current ? String(current.taxCents / 100) : ""}
                />
              </Field>
            )}
          </div>
          {!current?.proof && (
            <AccountingProofField
              file={proofFile}
              onClear={() => setProofFile(null)}
              onSelect={(file) => {
                setProofFile(file);
                setDirty(true);
              }}
            />
          )}
          <details
            className="accounting-group"
            open={purchaseId || dispatchId ? true : undefined}
          >
            <summary>Vincular pedido de materiales o despacho</summary>
            {origins.error && <Notice error>{origins.error}</Notice>}
            <div className="accounting-grid">
              {kind !== "materials" && (
                <Field label="Pedido de materiales asociado">
                  <Select
                    label="Pedido de materiales asociado"
                    value={purchaseId}
                    onChange={(value) => {
                      setPurchase(value);
                      setDirty(true);
                    }}
                    options={[
                      { value: "", label: "Sin pedido asociado" },
                      ...(origins.data?.purchases || []),
                    ]}
                  />
                </Field>
              )}
              <Field label="Despacho asociado">
                <Select
                  label="Despacho asociado"
                  value={dispatchId}
                  onChange={(value) => {
                    setDispatch(value);
                    setDirty(true);
                  }}
                  options={[
                    { value: "", label: "Sin despacho asociado" },
                    ...(origins.data?.dispatches || []),
                  ]}
                />
              </Field>
            </div>
          </details>
          <div className="accounting-group">
            <h3>Asignación por obra</h3>
            {splits.length === 0 && (
              <p className="hint">
                Sin asignación, el registro queda como gasto general.
              </p>
            )}
            {splits.map((item) => {
              const patch = (data: Partial<typeof item>) =>
                setSplits((previous) =>
                  previous.map((row) =>
                    row.id === item.id ? { ...row, ...data } : row,
                  ),
                );
              return (
                <div className="accounting-line" key={item.id}>
                  <Field label="Obra">
                    <Select
                      label="Obra"
                      value={item.workId}
                      options={(query.data || []).map((work) => ({
                        value: work.id,
                        label: work.name,
                      }))}
                      onChange={(workId) => patch({ workId })}
                    />
                  </Field>
                  <Field label="Importe asignado">
                    <input
                      required
                      inputMode="decimal"
                      value={item.amount}
                      onChange={(e) => patch({ amount: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label="Quitar asignación"
                    onClick={() =>
                      setSplits((rows) =>
                        rows.filter((row) => row.id !== item.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
            {query.error && <Notice error>{query.error}</Notice>}
            <Button
              variant="ghost"
              type="button"
              disabled={!query.data?.length || splits.length >= 30}
              onClick={() =>
                setSplits((rows) => [
                  ...rows,
                  {
                    id: crypto.randomUUID(),
                    workId: "",
                    amount: rows.length ? "" : net,
                  },
                ])
              }
            >
              <Plus size={16} /> Asignar a obra
            </Button>
          </div>
        </fieldset>
        {busy && !current && (
          <p className="hint" role="status">
            Comprobando si la factura ya está en SUNAT o en VECA…
          </p>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="accounting-form-actions">
          <Button variant="ghost" type="button" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={busy}
            validateForm={(fields) => parseCost(fields).success}
          >
            <Upload size={16} />{" "}
            {busy
              ? current
                ? "Guardando…"
                : "Comprobando factura…"
              : "Guardar registro"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
