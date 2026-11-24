import { useAccountingPermission } from "./AccountingAccess";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import {
  costInput,
  costKinds,
  COST_KIND_LABELS,
  type AccountingCost,
  type AccountingWork,
  type CostInput,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { API_BASE, api } from "../../lib/api";
import { Button, Field, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import {
  accountingPost,
  accountingPath,
  amount,
  decimal,
  Pagination,
  QueryState,
  recordId,
  Refresh,
  today,
  useAccountingQuery,
} from "./accounting-shared";

const path = accountingPath + "/costs";
type CostPage = { items: AccountingCost[]; hasMore: boolean };

export function AccountingCosts({
  purchaseId,
  inventoryAccess,
}: {
  purchaseId?: string;
  inventoryAccess: boolean;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState("");
  const query = useAccountingQuery<CostPage>(
    `${path}?page=${page}${month ? `&month=${month}` : ""}${purchaseId ? `&purchase=${encodeURIComponent(purchaseId)}` : ""}`,
  );
  const [entry, setEntry] = useState<"new" | AccountingCost>();
  const [active, setActive] = useState<AccountingCost>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = query.data?.items || [];

  async function apply(operation: "review" | "proof", file?: File) {
    if (!active || busy) return;
    setError("");
    setBusy(true);
    try {
      let result: AccountingCost;
      if (operation === "proof" && file) {
        const form = new FormData();
        form.append("file", file);
        result = await api<AccountingCost>(`${path}/${active.id}/proof`, {
          method: "POST",
          body: form,
        });
      } else {
        result = await accountingPost<AccountingCost>(
          `${path}/${active.id}/review`,
          { version: active.version },
        );
      }
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
        Registra y revisa los comprobantes. Las solicitudes y recepciones se
        gestionan desde Inventario.
      </p>
      {purchaseId && (
        <p className="hint">
          Mostrando el sustento de la compra seleccionada.{" "}
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
                Ver compra en Inventario
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
      <QueryState {...query} empty="No hay compras ni gastos en este periodo.">
        {rows.length > 0 && (
          <ul className="dispatch-list dispatch-queue">
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.description}</strong>
                  <small>
                    {COST_KIND_LABELS[row.kind]} · {row.date}
                  </small>
                </div>
                <span className="accounting-value">
                  {amount(row.netCents + row.taxCents)}
                </span>
                <span className="dispatch-pill">
                  {row.reviewed
                    ? "Revisado"
                    : row.proof
                      ? "Por revisar"
                      : "Falta sustento"}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    setActive(row);
                  }}
                >
                  Abrir
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
      {entry && (
        <CostForm
          current={entry === "new" ? undefined : entry}
          initialPurchase={purchaseId}
          onClose={() => setEntry(undefined)}
          onSaved={(row) => {
            setEntry(undefined);
            setActive(row);
            setPage(1);
            query.refresh();
          }}
        />
      )}
      {active && (
        <Modal
          title={active.description}
          busy={busy}
          onClose={() => setActive(undefined)}
        >
          <p>
            {COST_KIND_LABELS[active.kind]} · {active.date} ·{" "}
            {amount(active.netCents + active.taxCents)}
          </p>
          {active.supplier && (
            <p>
              {active.supplier}
              {active.supplierRuc && ` · ${active.supplierRuc}`}
              {active.reference && ` · ${active.reference}`}
            </p>
          )}
          <p>
            {active.allocations.length
              ? `Asignado a ${active.allocations.length} obra(s)`
              : "Gasto general"}
          </p>
          {active.purchaseId && inventoryAccess && (
            <a
              className="accounting-inline"
              href={`#inventory/compras/${active.purchaseId}`}
            >
              Ver compra en Inventario
            </a>
          )}
          {active.purchaseId && (
            <RelatedCost
              label="Compra asociada"
              id={active.purchaseId}
              name="purchases"
            />
          )}
          {active.dispatchId && (
            <RelatedCost
              label="Despacho asociado"
              id={active.dispatchId}
              name="dispatches"
            />
          )}
          {active.proof ? (
            <a
              className="accounting-inline"
              href={`${API_BASE}${path}/${active.id}/proof`}
            >
              Descargar sustento
            </a>
          ) : (
            <Field label="Adjuntar sustento PDF">
              <input
                className="accounting-file"
                type="file"
                disabled={!canWrite || busy}
                accept="application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void apply("proof", file);
                }}
              />
            </Field>
          )}
          {error && <Notice error>{error}</Notice>}
          {active.reviewed ? (
            <Notice>Registro revisado.</Notice>
          ) : (
            <div className="accounting-form-actions">
              <Button
                variant="ghost"
                disabled={!canWrite || busy}
                onClick={() => {
                  setEntry(active);
                  setActive(undefined);
                }}
              >
                Editar registro
              </Button>
              <Button
                disabled={!canWrite || busy || !active.proof}
                onClick={() => void apply("review")}
              >
                Marcar como revisado
              </Button>
            </div>
          )}
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
}: {
  current?: AccountingCost;
  initialPurchase?: string;
  onClose: () => void;
  onSaved: (row: AccountingCost) => void;
}) {
  const query = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [kind, setKind] = useState<CostInput["kind"]>(
    current?.kind || "purchase",
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
  const id = useRef(recordId());

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const dto = costInput.safeParse({
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
    if (!dto.success) {
      setError(dto.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = current
        ? await api<AccountingCost>(`${path}/${current.id}`, {
            method: "PUT",
            body: JSON.stringify({ version: current.version, data: dto.data }),
          })
        : await accountingPost<AccountingCost>(path, {
            id: id.current,
            data: dto.data,
          });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={current ? "Editar gasto o compra" : "Registrar gasto o compra"}
      size="wide"
      busy={busy}
      onClose={close}
    >
      <form onSubmit={save} onChange={() => setDirty(true)}>
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
          <details
            className="accounting-group"
            open={purchaseId || dispatchId ? true : undefined}
          >
            <summary>Vincular compra o despacho</summary>
            {origins.error && <Notice error>{origins.error}</Notice>}
            <div className="accounting-grid">
              {kind !== "materials" && (
                <Field label="Compra asociada">
                  <Select
                    label="Compra asociada"
                    value={purchaseId}
                    onChange={(value) => {
                      setPurchase(value);
                      setDirty(true);
                    }}
                    options={[
                      { value: "", label: "Sin compra asociada" },
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
        {error && <Notice error>{error}</Notice>}
        <div className="accounting-form-actions">
          <Button variant="ghost" type="button" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button disabled={busy}>
            <Upload size={16} /> {busy ? "Guardando…" : "Guardar registro"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
