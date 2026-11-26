import { useAccountingPermission } from "./AccountingAccess";
import {
  AccountingProofField,
  AccountingProofRetry,
  uploadAccountingProof,
} from "./AccountingProof";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { useId, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Download, Plus, Trash2 } from "lucide-react";
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
import { SireSalesReview } from "./SireSalesReview";
import { SireClosingGuide } from "./SireClosingGuide";
import {
  accountingPost,
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
  Summary,
} from "./accounting-shared";

import "./accounting-records.css";

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

const invoiceFilters = [
  { value: "", label: "Todas" },
  { value: "requested", label: "Solicitadas" },
  { value: "collect", label: "Por cobrar" },
] as const;
type InvoiceQueue = (typeof invoiceFilters)[number]["value"];

function InvoiceStatus({ row }: { row: AccountingInvoice }) {
  return (
    <span className="accounting-record-status" data-state={row.status}>
      {label[row.status]}
    </span>
  );
}

export function AccountingInvoices({
  selected,
  initialQueue = "",
  initialMonth,
}: {
  selected: string;
  initialQueue?: InvoiceQueue;
  initialMonth?: string;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState(initialQueue);
  const [month, setMonth] = useState(initialMonth || today().slice(0, 7));
  const [openInvoice, setOpenInvoice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const filterId = useId();
  const detailId = openInvoice || (selected !== "nueva" ? selected : "");
  const listHash = baseHash + (month ? `?month=${month}` : "");
  const query = useAccountingQuery<InvoicePage>(
    `${root}?page=${page}${queue ? `&queue=${queue}` : month ? `&month=${month}` : ""}`,
  );
  const rows = query.data?.items || [];
  function refreshInvoices() {
    setPage(1);
    query.refresh();
  }
  function invoiceChanged() {
    setRevision((value) => value + 1);
    query.refresh();
  }
  return (
    <section aria-labelledby="accounting-invoices">
      <header className="accounting-section-head">
        <h2 id="accounting-invoices">Facturas y cobros</h2>
        <div className="accounting-tools">
          {!month && (
            <Refresh loading={query.loading} onClick={query.refresh} />
          )}
          {canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" /> Nueva factura
            </Button>
          )}
        </div>
      </header>
      <div className="accounting-filters">
        <Field label="Periodo de ventas">
          <input
            type="month"
            value={month}
            onChange={(event) => {
              if (!queue) setPage(1);
              setMonth(event.target.value);
            }}
          />
        </Field>
      </div>
      {month && (
        <SireSalesReview
          key={`sales-summary:${month}`}
          month={month}
          refreshing={query.loading}
          revision={revision}
          onRefresh={refreshInvoices}
        />
      )}
      <section
        className="invoice-records"
        aria-labelledby="invoice-records-heading"
      >
        <header className="invoice-records-header">
          <h3 id="invoice-records-heading">Facturas en VECA</h3>
          <Field label="Ver facturas" htmlFor={filterId}>
            <Select
              id={filterId}
              value={queue}
              options={invoiceFilters}
              onChange={(value) => {
                const filter = invoiceFilters.find(
                  (option) => option.value === value,
                );
                if (!filter) return;
                setPage(1);
                setQueue(filter.value);
              }}
            />
          </Field>
        </header>
        {query.data && !query.data.enabled && (
          <Notice>
            Emisión electrónica pendiente de configuración. Puedes preparar
            borradores.
          </Notice>
        )}
        <QueryState
          {...query}
          empty={
            queue === "requested"
              ? "No hay facturas solicitadas."
              : queue === "collect"
                ? "No hay facturas por cobrar."
                : month
                  ? "No hay facturas en este periodo."
                  : "Todavía no hay facturas registradas."
          }
        >
          {rows.length > 0 && (
            <ul className="accounting-record-list">
              {rows.map((row) => {
                const balance = row.totalCents - row.paidCents;
                return (
                  <li key={row.id}>
                    <div className="accounting-record-label">
                      <strong>{row.customer}</strong>
                      <small>
                        {row.number || row.workName || "Venta directa"}
                        {row.issueDate && ` · ${displayDate(row.issueDate)}`}
                      </small>
                    </div>
                    <div className="accounting-record-meta">
                      <div className="accounting-record-amount invoice-row-amount">
                        {row.status !== "requested" && (
                          <strong>
                            {amount(
                              queue === "collect" ? balance : row.totalCents,
                            )}
                          </strong>
                        )}
                        {queue === "collect" ? (
                          <small>Saldo por cobrar</small>
                        ) : isIssued(row) && balance > 0 ? (
                          <small>
                            {row.paidCents
                              ? `Por cobrar ${amount(balance)}`
                              : "Por cobrar"}
                          </small>
                        ) : null}
                      </div>
                      <InvoiceStatus row={row} />
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => setOpenInvoice(row.id)}
                    >
                      Ver detalle <ChevronRight size={14} aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
        <Pagination
          page={page}
          hasMore={Boolean(query.data?.hasMore)}
          change={setPage}
        />
      </section>
      {canWrite && (creating || selected === "nueva") && (
        <InvoiceForm
          onClose={() => {
            if (selected === "nueva") location.hash = listHash;
            else setCreating(false);
          }}
          onSaved={(saved) => {
            setPage(1);
            invoiceChanged();
            if (selected === "nueva") {
              location.hash = `${baseHash}/${saved.id}${month ? `?month=${month}` : ""}`;
            } else {
              setCreating(false);
              setOpenInvoice(saved.id);
            }
          }}
        />
      )}
      {detailId && (
        <InvoiceDetail
          key={detailId}
          id={detailId}
          onChanged={invoiceChanged}
          onClose={() => {
            if (openInvoice) setOpenInvoice(undefined);
            else location.hash = listHash;
          }}
        />
      )}
      {month && (
        <SireClosingGuide
          key={`sales-closing:${month}`}
          month={month}
          book="sales"
        />
      )}
    </section>
  );
}

function InvoiceForm({
  current,
  onSaved,
  onClose,
}: {
  onClose: () => void;
  current?: AccountingInvoice;
  onSaved: (invoice: AccountingInvoice) => void;
}) {
  const formId = useId();
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
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [pendingProof, setPendingProof] = useState<{
    record: AccountingInvoice;
    file: File;
    error: string;
  }>();
  function finish(saved: AccountingInvoice) {
    clearGuard();
    setDirty(false);
    onSaved(saved);
  }
  function close() {
    if (confirmDiscard(dirty, busy)) {
      clearGuard();
      onClose();
    }
  }
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

  const parseInvoice = () =>
    invoiceInput.safeParse({
      workId: work,
      customer,
      customerRuc: ruc,
      method,
      dueDate: method === "credit" ? due : "",
      items,
    });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const parsed = parseInvoice();
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      let saved = current
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
      if (proofFile && !saved.proof) {
        try {
          saved = await uploadAccountingProof<AccountingInvoice>(
            `${root}/${saved.id}`,
            proofFile,
          );
        } catch (error) {
          clearGuard();
          setDirty(false);
          setPendingProof({
            record: saved,
            file: proofFile,
            error: (error as Error).message,
          });
          return;
        }
      }
      finish(saved);
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
          finish(
            await uploadAccountingProof<AccountingInvoice>(
              `${root}/${pendingProof.record.id}`,
              file,
            ),
          );
        }}
        onSkip={() => finish(pendingProof.record)}
      />
    );
  return (
    <Modal
      title={current ? "Editar borrador" : "Nueva factura"}
      description="Prepara el comprobante y revisa los importes antes de emitirlo."
      size="wide"
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !parseInvoice().success}
          >
            {busy ? "Guardando…" : "Guardar borrador"}
          </Button>
        </footer>
      }
    >
      <form
        id={formId}
        className="accounting-form accounting-invoice-form"
        onSubmit={save}
        onChange={() => setDirty(true)}
      >
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
                floating
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
                floating
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
                    onClick={() => {
                      setDirty(true);
                      setDraft((rows) =>
                        rows.filter((row) => row.id !== item.id),
                      );
                    }}
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
              onClick={() => {
                setDirty(true);
                setDraft((rows) => [
                  ...rows,
                  {
                    id: crypto.randomUUID(),
                    description: "",
                    quantity: "1",
                    unit: "",
                  },
                ]);
              }}
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
      </form>
    </Modal>
  );
}

function InvoiceDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const canIssue = useAccountingPermission("accounting_issue");
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
  async function attachProof(file: File) {
    if (deadline.current) return;
    deadline.current = true;
    setBusy(true);
    setError("");
    try {
      setOverride(await uploadAccountingProof<AccountingInvoice>(path, file));
      onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      deadline.current = false;
      setBusy(false);
    }
  }

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
      onChanged();
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

  const canEdit =
    canWrite && row && ["requested", "draft", "rejected"].includes(row.status);
  const canSend = canIssue && row?.status === "draft" && query.data?.enabled;
  const canCheck = canIssue && row?.canCheck;
  const issued = row && isIssued(row);
  const balance = row ? row.totalCents - row.paidCents : 0;
  const canCollect = canWrite && issued && balance > 0;

  return (
    <>
      <Modal
        title={row?.customer || "Detalle de factura"}
        description={
          row
            ? [row.number, row.workName || "Venta directa"]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        busy={busy}
        onClose={onClose}
        footer={
          (canEdit || canSend || canCheck || canCollect) && (
            <footer className="ve-modal-actions">
              {canEdit && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEdit(true)}
                >
                  Editar factura
                </Button>
              )}
              {canSend && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setAction("issue");
                  }}
                >
                  Revisar y emitir
                </Button>
              )}
              {canCheck && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run("check")}
                >
                  Consultar estado
                </Button>
              )}
              {canCollect && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setAction("payment");
                  }}
                >
                  Registrar cobro
                </Button>
              )}
            </footer>
          )
        }
      >
        <QueryState {...query}>
          {row && (
            <div className="invoice-detail">
              <div className="invoice-detail-status">
                <InvoiceStatus row={row} />
              </div>
              <dl className="accounting-record-facts">
                {row.status !== "requested" && (
                  <div className="accounting-record-total">
                    <dt>Total</dt>
                    <dd>{amount(row.totalCents)}</dd>
                  </div>
                )}
                {issued && (
                  <>
                    <div>
                      <dt>Saldo por cobrar</dt>
                      <dd>{amount(balance)}</dd>
                    </div>
                    <div>
                      <dt>Cobrado</dt>
                      <dd>{amount(row.paidCents)}</dd>
                    </div>
                  </>
                )}
                {row.customerRuc && (
                  <div>
                    <dt>RUC</dt>
                    <dd>{row.customerRuc}</dd>
                  </div>
                )}
                {row.issueDate && (
                  <div>
                    <dt>Fecha de emisión</dt>
                    <dd>{displayDate(row.issueDate)}</dd>
                  </div>
                )}
                {row.dueDate && (
                  <div>
                    <dt>Vencimiento</dt>
                    <dd>{displayDate(row.dueDate)}</dd>
                  </div>
                )}
              </dl>
              {row.observation && <Notice>{row.observation}</Notice>}
              {row.items.length > 0 && (
                <section className="invoice-detail-section">
                  <h3>Conceptos</h3>
                  <ul className="invoice-detail-lines">
                    {row.items.map((item, index) => (
                      <li key={index}>
                        <div>
                          <strong>{item.description}</strong>
                          <small>Cantidad · {item.quantityMilli / 1000}</small>
                        </div>
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
                </section>
              )}
              {row.payments.length > 0 && (
                <section className="invoice-detail-section">
                  <h3>Cobros registrados</h3>
                  <ul className="invoice-detail-lines">
                    {row.payments.map((payment, index) => (
                      <li key={index}>
                        <div>
                          <strong>{displayDate(payment.date)}</strong>
                          {payment.reference && (
                            <small>{payment.reference}</small>
                          )}
                        </div>
                        <strong>{amount(payment.cents)}</strong>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(issued || row.proof || canWrite) && (
                <section className="invoice-detail-section">
                  <h3>Archivos</h3>
                  <div className="invoice-detail-links">
                    {issued &&
                      (["pdf", "xml", "cdr"] as const).map((type) => (
                        <a
                          className="accounting-inline"
                          key={type}
                          href={`${API_BASE}${path}/file/${type}`}
                          aria-label={`Descargar ${type.toUpperCase()}`}
                        >
                          {type.toUpperCase()}
                        </a>
                      ))}
                    {row.proof && (
                      <a
                        className="accounting-inline"
                        href={`${API_BASE}${path}/proof`}
                      >
                        <Download size={15} aria-hidden="true" /> Descargar
                        sustento
                      </a>
                    )}
                  </div>
                  {!row.proof && canWrite && (
                    <AccountingProofField
                      file={null}
                      optionalAtSave={false}
                      hint="Adjunto opcional. Foto o PDF de hasta 8 MB."
                      disabled={busy}
                      onSelect={(file) => void attachProof(file)}
                    />
                  )}
                </section>
              )}
              {error && !action && <Notice error>{error}</Notice>}
              {row.status === "draft" && !query.data?.enabled && (
                <Notice>Emisión electrónica pendiente de configuración.</Notice>
              )}
            </div>
          )}
        </QueryState>
      </Modal>
      {edit && row && (
        <InvoiceForm
          current={row}
          onClose={() => setEdit(false)}
          onSaved={(saved) => {
            setOverride(saved);
            setEdit(false);
            onChanged();
          }}
        />
      )}
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
                type="submit"
                disabled={
                  busy ||
                  (action === "payment" &&
                    (!date || !(decimal(cash) > 0 && decimal(cash) <= balance)))
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
    </>
  );
}
