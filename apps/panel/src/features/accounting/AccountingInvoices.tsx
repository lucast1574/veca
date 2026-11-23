import { useUnsavedChanges } from "../../lib/unsaved";
import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  accountingTotals,
  invoiceInput,
  type AccountingInvoice,
  type AccountingWork,
  type InvoiceInput,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { API_BASE, api } from "../../lib/api";
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

const root = accountingPath + "/invoices";
const baseHash = "#accounting/facturas";
const label: Record<AccountingInvoice["status"], string> = {
  requested: "Solicitada",
  draft: "Borrador",
  sending: "Enviando",
  pending: "Por confirmar",
  accepted: "Aceptada",
  observed: "Aceptada con observaciones",
  rejected: "Requiere corrección",
};
const isIssued = (row: AccountingInvoice) =>
  row.status === "accepted" || row.status === "observed";
type InvoicePage = {
  items: AccountingInvoice[];
  hasMore: boolean;
  enabled: boolean;
};

export function AccountingInvoices({
  selected,
  queue = "",
}: {
  selected: string;
  queue?: "" | "requested" | "collect";
}) {
  const [page, setPage] = useState(1);
  const query = useAccountingQuery<InvoicePage>(
    selected ? "" : `${root}?page=${page}${queue ? "&queue=" + queue : ""}`,
  );
  if (selected === "nueva") return <InvoiceForm />;
  if (selected) return <InvoiceDetail id={selected} />;
  const rows = query.data?.items || [];
  return (
    <section aria-labelledby="accounting-invoices">
      <header className="accounting-section-head">
        <h2 id="accounting-invoices">Facturas y cobros</h2>
        <div className="accounting-tools">
          <Refresh loading={query.loading} onClick={query.refresh} />
          <a
            className="btn btn-primary accounting-inline"
            href={baseHash + "/nueva"}
          >
            <Plus size={16} /> Nueva factura
          </a>
        </div>
      </header>
      <nav className="accounting-tabs" aria-label="Filtrar facturas">
        <a
          className="accounting-inline"
          href={baseHash}
          aria-current={!queue ? "page" : undefined}
        >
          Todas
        </a>
        <a
          className="accounting-inline"
          href={baseHash + "/solicitadas"}
          aria-current={queue === "requested" ? "page" : undefined}
        >
          Solicitadas
        </a>
        <a
          className="accounting-inline"
          href={baseHash + "/por-cobrar"}
          aria-current={queue === "collect" ? "page" : undefined}
        >
          Por cobrar
        </a>
      </nav>
      {query.data && !query.data.enabled && (
        <Notice>
          Emisión electrónica pendiente de configuración. Puedes preparar
          borradores.
        </Notice>
      )}
      <QueryState
        {...query}
        empty={
          queue
            ? "No hay facturas en esta bandeja."
            : "Todavía no hay facturas registradas."
        }
      >
        {rows.length > 0 && (
          <ul className="dispatch-list dispatch-queue">
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.customer}</strong>
                  <small>{row.number || row.workName || "Venta directa"}</small>
                </div>
                <div className="accounting-value">
                  {row.status === "requested" ? "—" : amount(row.totalCents)}
                  {isIssued(row) && (
                    <small>
                      Por cobrar {amount(row.totalCents - row.paidCents)}
                    </small>
                  )}
                </div>
                <span className="dispatch-pill" data-state={row.status}>
                  {label[row.status]}
                </span>
                <a className="accounting-inline" href={`${baseHash}/${row.id}`}>
                  Abrir <ChevronRight size={16} />
                </a>
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
  );
}

function InvoiceForm({
  current,
  onSaved,
}: {
  current?: AccountingInvoice;
  onSaved?: (invoice: AccountingInvoice) => void;
}) {
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [work, setWork] = useState(current?.workId || "");
  const [customer, setCustomer] = useState(current?.customer || "");
  const [ruc, setRuc] = useState(current?.customerRuc || "");
  const [method, setMethod] = useState<InvoiceInput["method"]>(
    current?.method || "cash",
  );
  const [due, setDue] = useState(current?.dueDate || "");
  const [draft, setDraft] = useState(() =>
    (current?.items.length
      ? current.items
      : [{ description: "", quantityMilli: 1000, unitCents: 0 }]
    ).map((item) => ({
      id: crypto.randomUUID(),
      description: item.description,
      quantity: String(item.quantityMilli / 1000),
      unit: item.unitCents ? String(item.unitCents / 100) : "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const clearGuard = useUnsavedChanges(dirty, busy);
  const [error, setError] = useState("");
  const id = useRef(recordId());
  const items = draft.map((item) => ({
    description: item.description,
    quantityMilli: decimal(item.quantity, 3),
    unitCents: decimal(item.unit),
  }));
  const totals = accountingTotals(items);
  const workOptions = [
    { value: "", label: "Venta directa" },
    ...(works.data || []).map((item) => ({ value: item.id, label: item.name })),
  ];
  if (
    current?.workId &&
    !workOptions.some((item) => item.value === current.workId)
  )
    workOptions.push({ value: current.workId, label: current.workName });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const parsed = invoiceInput.safeParse({
      workId: work,
      customer,
      customerRuc: ruc,
      method,
      dueDate: method === "credit" ? due : "",
      items,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const saved = current
        ? await api<AccountingInvoice>(`${root}/${current.id}`, {
            method: "PUT",
            body: JSON.stringify({
              version: current.version,
              data: parsed.data,
            }),
          })
        : await accountingPost<AccountingInvoice>(root, {
            id: id.current,
            data: parsed.data,
          });
      clearGuard();
      setDirty(false);
      if (onSaved) onSaved(saved);
      else location.hash = `${baseHash}/${saved.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {!current && (
        <a className="accounting-inline" href={baseHash}>
          <ArrowLeft size={16} /> Facturas y cobros
        </a>
      )}
      <form
        className="accounting-form accounting-group"
        onSubmit={save}
        onChange={() => setDirty(true)}
      >
        <h2>{current ? "Editar borrador" : "Nueva factura"}</h2>
        <fieldset disabled={busy}>
          <div className="accounting-grid">
            <Field label="Cliente o razón social">
              <input
                required
                maxLength={150}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </Field>
            <Field label="RUC">
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{11}"
                maxLength={11}
                value={ruc}
                onChange={(e) => setRuc(e.target.value)}
              />
            </Field>
            <Field label="Origen">
              <Select
                label="Origen"
                value={work}
                options={workOptions}
                onChange={(value) => {
                  setWork(value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Forma de pago">
              <Select
                label="Forma de pago"
                value={method}
                options={[
                  { value: "cash", label: "Contado" },
                  { value: "credit", label: "Crédito" },
                ]}
                onChange={(value) => {
                  setMethod(value as InvoiceInput["method"]);
                  setDirty(true);
                }}
              />
            </Field>
            {method === "credit" && (
              <Field label="Vencimiento">
                <input
                  type="date"
                  required
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
            )}
          </div>
          {works.error && (
            <Notice error>
              Las obras no están disponibles. {works.error}{" "}
              <button type="button" onClick={works.refresh}>
                Recargar obras
              </button>
            </Notice>
          )}
          <div className="accounting-group">
            <h3>Conceptos</h3>
            {draft.map((item) => {
              const change = (
                key: "description" | "quantity" | "unit",
                value: string,
              ) =>
                setDraft((rows) =>
                  rows.map((row) =>
                    row.id === item.id ? { ...row, [key]: value } : row,
                  ),
                );
              return (
                <div className="accounting-line" key={item.id}>
                  <Field label="Descripción">
                    <input
                      required
                      maxLength={250}
                      value={item.description}
                      onChange={(e) => change("description", e.target.value)}
                    />
                  </Field>
                  <Field label="Cantidad">
                    <input
                      required
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(e) => change("quantity", e.target.value)}
                    />
                  </Field>
                  <Field label="Precio sin IGV">
                    <input
                      required
                      inputMode="decimal"
                      value={item.unit}
                      onChange={(e) => change("unit", e.target.value)}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Quitar concepto"
                    disabled={draft.length === 1}
                    onClick={() =>
                      setDraft((rows) =>
                        rows.filter((row) => row.id !== item.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              disabled={draft.length >= 30}
              onClick={() =>
                setDraft((rows) => [
                  ...rows,
                  {
                    id: crypto.randomUUID(),
                    description: "",
                    quantity: "1",
                    unit: "",
                  },
                ])
              }
            >
              <Plus size={16} /> Añadir concepto
            </Button>
          </div>
        </fieldset>
        <Summary
          entries={[
            ["Neto", totals.netCents],
            ["IGV", totals.taxCents],
            ["Total", totals.totalCents],
          ]}
        />
        {error && <Notice error>{error}</Notice>}
        <div className="accounting-form-actions">
          <Button disabled={busy}>
            {busy ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const path = `${root}/${id}`;
  const query = useAccountingQuery<{
    invoice: AccountingInvoice;
    enabled: boolean;
  }>(path);
  const [override, setOverride] = useState<AccountingInvoice>();
  const row = override || query.data?.invoice;
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState<"issue" | "payment" | null>(null);
  const [cash, setCash] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deadline = useRef(false);

  async function run(command: "issue" | "payment" | "check") {
    if (!row || deadline.current) return;
    deadline.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await accountingPost<AccountingInvoice>(
        `${path}/${command}`,
        {
          version: row.version,
          ...(command === "payment"
            ? { cents: decimal(cash), date, reference }
            : {}),
        },
      );
      setOverride(result);
      setCash("");
      setReference("");
      setAction(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      deadline.current = false;
    }
  }

  if (edit && row)
    return (
      <>
        <Button variant="ghost" onClick={() => setEdit(false)}>
          <ArrowLeft size={16} /> Volver a factura
        </Button>
        <InvoiceForm
          current={row}
          onSaved={(saved) => {
            setOverride(saved);
            setEdit(false);
          }}
        />
      </>
    );

  return (
    <section className="dispatch-review">
      <a className="accounting-inline" href={baseHash}>
        <ArrowLeft size={16} /> Facturas y cobros
      </a>
      <QueryState {...query}>
        {row && (
          <div className="accounting-group">
            <div className="accounting-section-head">
              <div>
                <h2>{row.customer}</h2>
                <small>
                  {row.number || row.workName || "Venta directa"} ·{" "}
                  {row.customerRuc}
                </small>
              </div>
              <span className="dispatch-pill" data-state={row.status}>
                {label[row.status]}
              </span>
            </div>
            {row.observation && <Notice>{row.observation}</Notice>}
            <Summary
              entries={[
                ["Total", row.totalCents],
                ["Cobrado", row.paidCents],
                ["Saldo", row.totalCents - row.paidCents],
              ]}
            />
            <div className="ops-card">
              <h3>Conceptos</h3>
              <ul className="dispatch-list">
                {row.items.map((item, index) => (
                  <li key={index}>
                    <span>
                      {item.description} · {item.quantityMilli / 1000}
                    </span>
                    <strong>
                      {amount(
                        Math.round(
                          (item.quantityMilli * item.unitCents) / 1000,
                        ),
                      )}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
            {row.payments.length > 0 && (
              <div className="accounting-group">
                <h3>Cobros</h3>
                <ul className="dispatch-list">
                  {row.payments.map((payment, index) => (
                    <li key={index}>
                      <span>
                        {payment.date}
                        {payment.reference && ` · ${payment.reference}`}
                      </span>
                      <strong>{amount(payment.cents)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && !action && <Notice error>{error}</Notice>}
            {row.status === "draft" && !query.data?.enabled && (
              <Notice>Emisión electrónica pendiente de configuración.</Notice>
            )}
            <div className="accounting-form-actions">
              {["requested", "draft", "rejected"].includes(row.status) && (
                <Button variant="ghost" onClick={() => setEdit(true)}>
                  Editar
                </Button>
              )}
              {row.status === "draft" && query.data?.enabled && (
                <Button
                  onClick={() => {
                    setError("");
                    setAction("issue");
                  }}
                >
                  Revisar y emitir
                </Button>
              )}
              {row.canCheck && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run("check")}
                >
                  Consultar estado
                </Button>
              )}
              {isIssued(row) && (
                <>
                  {(["pdf", "xml", "cdr"] as const).map((type) => (
                    <a
                      className="accounting-inline"
                      key={type}
                      href={`${API_BASE}${path}/file/${type}`}
                    >
                      {type.toUpperCase()}
                    </a>
                  ))}
                  {row.paidCents < row.totalCents && (
                    <Button
                      onClick={() => {
                        setError("");
                        setAction("payment");
                      }}
                    >
                      Registrar cobro
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </QueryState>
      {action && row && (
        <Modal
          title={action === "issue" ? "Confirmar emisión" : "Registrar cobro"}
          busy={busy}
          onClose={() => setAction(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(action);
            }}
          >
            {action === "issue" ? (
              <p>
                Factura para <strong>{row.customer}</strong> por{" "}
                <strong>{amount(row.totalCents)}</strong>.
              </p>
            ) : (
              <>
                <Field label="Importe del cobro">
                  <input
                    inputMode="decimal"
                    required
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                  />
                </Field>
                <Field label="Fecha del cobro">
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <Field label="Referencia">
                  <input
                    maxLength={120}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </>
            )}
            {error && <Notice error>{error}</Notice>}
            <div className="accounting-form-actions">
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancelar
              </Button>
              <Button
                disabled={
                  busy ||
                  (action === "payment" &&
                    (!decimal(cash) ||
                      decimal(cash) > row.totalCents - row.paidCents))
                }
              >
                {busy
                  ? "Procesando…"
                  : action === "issue"
                    ? "Confirmar y emitir"
                    : "Guardar cobro"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function Summary({ entries }: { entries: [string, number][] }) {
  return (
    <div className="accounting-summary">
      {entries.map(([name, value]) => (
        <div key={name}>
          <span>{name}</span>
          <strong>{amount(value)}</strong>
        </div>
      ))}
    </div>
  );
}
