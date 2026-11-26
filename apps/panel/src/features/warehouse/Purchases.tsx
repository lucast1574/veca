import { Select } from "@veca/ui/src/Select";
import { useId, useRef, useState } from "react";
import {
  ClipboardList,
  Plus,
  Trash2,
  PackageCheck,
  Search,
} from "lucide-react";
import { purchaseRequest, type Purchase, type Material } from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { PurchasePreparation } from "./PurchasePreparation";
import {
  amount as money,
  Pagination,
  QueryState,
  recordId,
  Refresh,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { amount, date, unitName } from "../operations/shared";
import {
  WarehouseBack,
  materialOptions,
  postWarehouse,
  purchaseStatus,
  stringField,
  useWarehouseMaterials,
  warehousePath,
  WarehouseForm,
  WarehouseSelect,
} from "./shared";

export const PURCHASES_TITLE = "Recepción de compras";
const path = warehousePath + "/purchases";
type Item = Purchase["items"][number];
type Receipt = Purchase["receipts"][number];

type ReceiptTarget = { item: Item; pending?: Receipt };

function remainingQuantity(item: Item) {
  return Math.max(0, Math.round((item.ordered - item.received) * 1000) / 1000);
}

function receiptTargets(row: Purchase): ReceiptTarget[] {
  if (row.status !== "open" && row.status !== "partial") return [];
  return row.items
    .filter((item) => remainingQuantity(item) > 0)
    .map((item) => ({
      item,
      pending: row.receipts.find(
        (receipt) => receipt.materialId === item.materialId && !receipt.applied,
      ),
    }));
}

function PurchaseCard({
  row,
  accountingWrite,
  canReceive,
  onReceive,
}: {
  row: Purchase;
  accountingWrite: boolean;
  canReceive: boolean;
  onReceive: (target: ReceiptTarget) => void;
}) {
  const detail = `#inventory/compras/${row.id}`;
  const targets = receiptTargets(row);
  const direct = canReceive && targets.length === 1 ? targets[0] : undefined;
  const prepare = row.status === "requested" && accountingWrite;
  const waiting = row.status === "requested";
  const receiving = targets.length > 0;
  const resuming = targets.some((target) => target.pending);
  return (
    <li className="purchase-card" data-status={row.status}>
      <header>
        <h3>
          <ClipboardList size={17} aria-hidden="true" />
          {row.supplier || "Pedido sin proveedor asignado"}
        </h3>
        <span
          className="ops-stock-status warehouse-order-status"
          data-state={row.status}
        >
          {purchaseStatus[row.status]}
        </span>
      </header>
      <dl className="purchase-meta">
        <div>
          <dt>Destino</dt>
          <dd>{row.workName || "Almacén general"}</dd>
        </div>
        {row.invoiceSource?.reference && (
          <div>
            <dt>Factura</dt>
            <dd>{row.invoiceSource.reference}</dd>
          </div>
        )}
        <div>
          <dt>Registrado</dt>
          <dd>{date(row.createdAt)}</dd>
        </div>
      </dl>
      <div className="purchase-step">
        <div>
          {waiting ? (
            <strong>Contabilidad prepara el pedido</strong>
          ) : receiving ? (
            <>
              <strong>
                {resuming ? "Recepción por confirmar" : "Pendiente de recibir"}
              </strong>
              <ul
                className="purchase-pending"
                aria-label="Materiales por recibir"
              >
                {targets.slice(0, 2).map(({ item }) => (
                  <li key={item.materialId}>
                    <b>
                      {amount(remainingQuantity(item))} {unitName(item.unit)}
                    </b>{" "}
                    · {item.name}
                  </li>
                ))}
                {targets.length > 2 && <li>Y {targets.length - 2} más</li>}
              </ul>
            </>
          ) : (
            <strong>
              {row.status === "cancelled"
                ? "Pedido cerrado por cancelación"
                : "Recepción completa"}
            </strong>
          )}
        </div>
        {direct ? (
          <Button type="button" onClick={() => onReceive(direct)}>
            <PackageCheck size={16} aria-hidden="true" />
            {direct.pending ? "Continuar recepción" : "Registrar recepción"}
          </Button>
        ) : prepare ? (
          <a
            className="btn btn-primary"
            href={`#accounting/gastos/${row.id}/preparar`}
          >
            Completar en Contabilidad
          </a>
        ) : (
          <a
            className={`btn ${receiving && canReceive ? "btn-primary" : "btn-ghost"}`}
            href={detail}
          >
            {receiving && canReceive
              ? "Elegir material"
              : row.status === "received"
                ? "Ver recepciones"
                : "Ver pedido"}
          </a>
        )}
      </div>
      {(direct || prepare) && (
        <a className="warehouse-link purchase-detail-link" href={detail}>
          Ver pedido
        </a>
      )}
    </li>
  );
}

export function Purchases({
  selected,
  workId = "",
  accountingAccess = false,
  accountingWrite = false,
  canRequest = false,
  canReceive = false,
}: {
  selected?: string;
  workId?: string;
  accountingAccess?: boolean;
  accountingWrite?: boolean;
  canRequest?: boolean;
  canReceive?: boolean;
}) {
  const [requesting, setRequesting] = useState(Boolean(workId) && canRequest);
  const [receiving, setReceiving] = useState<
    ReceiptTarget & { row: Purchase }
  >();
  const [receivedMessage, setReceivedMessage] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams({ page: String(page) });
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  const list = useAccountingQuery<{ items: Purchase[]; hasMore: boolean }>(
    selected ? "" : `${path}?${params}`,
  );
  const materials = useWarehouseMaterials();
  const query = useAccountingQuery<Purchase>(
    selected ? `${path}/${selected}` : "",
  );
  if (selected)
    return (
      <QueryState {...query}>
        {query.data && (
          <PurchaseDetail
            key={query.data.id}
            row={query.data}
            refresh={query.refresh}
            accountingAccess={accountingAccess}
            accountingWrite={accountingWrite}
            canReceive={canReceive}
          />
        )}
      </QueryState>
    );
  return (
    <section className="warehouse-section" aria-labelledby="purchase-heading">
      <header className="accounting-section-head purchase-heading">
        <div>
          <h2 id="purchase-heading">{PURCHASES_TITLE}</h2>
          <p className="hint">
            {canReceive
              ? "Registra los materiales que llegan del proveedor."
              : "Consulta entregas de proveedores y cantidades pendientes."}
          </p>
        </div>
      </header>
      <div className="purchase-filters">
        <label className="search-input">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Buscar compras"
            type="search"
            placeholder="Proveedor, factura, obra o material"
            maxLength={100}
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </label>
        <Select
          label="Estado de la compra"
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={[
            { value: "", label: "Todas las compras" },
            { value: "pending_receipt", label: "Por recibir" },
            { value: "requested", label: "En Contabilidad" },
            { value: "received", label: "Recibidas" },
            { value: "cancelled", label: "Canceladas" },
          ]}
        />
        <Refresh loading={list.loading} onClick={list.refresh} />
      </div>
      {receivedMessage && <Notice>{receivedMessage}</Notice>}
      <QueryState
        {...list}
        empty={
          !search && status === "pending_receipt"
            ? "No hay compras por recibir."
            : search || status
              ? "No hay compras con estos filtros."
              : "Aún no hay compras registradas."
        }
      >
        {Boolean(list.data?.items.length) && (
          <ul className="warehouse-records">
            {list.data?.items.map((row) => (
              <PurchaseCard
                key={row.id}
                row={row}
                accountingWrite={accountingWrite}
                canReceive={canReceive}
                onReceive={(target) => setReceiving({ row, ...target })}
              />
            ))}
          </ul>
        )}
      </QueryState>
      <Pagination
        page={page}
        hasMore={Boolean(list.data?.hasMore)}
        change={setPage}
      />
      {canReceive && receiving && (
        <ReceiveForm
          {...receiving}
          close={() => setReceiving(undefined)}
          done={() => {
            setReceiving(undefined);
            setReceivedMessage(
              `Recepción registrada para ${receiving.item.name}. Se actualizó el stock.`,
            );
            list.refresh();
          }}
        />
      )}
      {requesting && (
        <PurchaseRequestForm
          materials={materials.data || []}
          loadError={materials.error}
          workId={workId}
          close={() => setRequesting(false)}
          done={(row) => {
            setRequesting(false);
            location.hash = `inventory/compras/${row.id}`;
          }}
        />
      )}
    </section>
  );
}

function PurchaseRequestForm({
  materials,
  workId,
  loadError,
  close,
  done,
}: {
  materials: Material[];
  workId: string;
  loadError?: string;
  close: () => void;
  done: (row: Purchase) => void;
}) {
  const newLine = () => ({ key: crypto.randomUUID(), materialId: "" });
  const [rows, setRows] = useState(() => [newLine()]);
  const id = useRef(recordId());
  const parseDraft = (form: FormData) =>
    purchaseRequest.safeParse({
      id: id.current,
      workId,
      reason: stringField(form, "reason"),
      materials: rows.map((row) => ({
        materialId: row.materialId,
        quantity: Number(form.get(row.key)),
      })),
    });
  return (
    <WarehouseForm
      title="Solicitar pedido para la obra"
      action="Enviar solicitud"
      wide
      onClose={close}
      validateForm={(form) => parseDraft(form).success}
      save={async (form) => {
        const payload = parseDraft(form);
        if (!payload.success)
          throw new Error(
            "Revisa el motivo, los códigos sin repetir y las cantidades.",
          );
        done(
          await postWarehouse<Purchase>(
            warehousePath + "/purchase-requests",
            payload.data,
          ),
        );
      }}
    >
      <p className="hint">
        Indica qué materiales faltan. Almacén revisará la solicitud y preparará
        el pedido al proveedor.
      </p>
      {loadError && <Notice error>{loadError}</Notice>}
      <Field label="Motivo de la solicitud">
        <input name="reason" maxLength={500} required />
      </Field>
      {rows.map((row, index) => (
        <div key={row.key} className="warehouse-edit-line">
          <WarehouseSelect
            label="Código o material"
            required
            value={row.materialId}
            options={materialOptions(materials)}
            onChange={(materialId) =>
              setRows((current) =>
                current.map((item) =>
                  item.key === row.key ? { ...item, materialId } : item,
                ),
              )
            }
          />
          <Field label="Cantidad solicitada">
            <input
              name={row.key}
              required
              type="number"
              min="0.001"
              step="0.001"
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Quitar material ${index + 1}`}
            disabled={rows.length <= 1}
            onClick={() =>
              setRows((current) =>
                current.filter((item) => item.key !== row.key),
              )
            }
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        disabled={rows.length >= 40}
        onClick={() => setRows((current) => [...current, newLine()])}
      >
        <Plus size={16} /> Añadir material
      </Button>
    </WarehouseForm>
  );
}

const detailTabs = [
  { id: "materials", label: "Materiales" },
  { id: "receipts", label: "Recepciones" },
  { id: "details", label: "Pedido" },
] as const;

function PurchaseDetail({
  row,
  refresh,
  accountingAccess,
  accountingWrite,
  canReceive,
}: {
  row: Purchase;
  refresh: () => void;
  accountingAccess: boolean;
  accountingWrite: boolean;
  canReceive: boolean;
}) {
  const tabId = useId();
  const [activeTab, setActiveTab] = useState<(typeof detailTabs)[number]["id"]>(
    row.status === "received"
      ? "receipts"
      : row.items.length
        ? "materials"
        : "details",
  );
  const appliedReceipts = row.receipts.filter((receipt) => receipt.applied);
  const [receiving, setReceiving] = useState<ReceiptTarget>();
  const targets = new Map(
    receiptTargets(row).map((target) => [target.item.materialId, target]),
  );
  const items = [...row.items].sort(
    (a, b) =>
      Number(targets.has(b.materialId)) - Number(targets.has(a.materialId)),
  );
  const total = row.items.reduce(
    (sum, line) => sum + Math.round(line.ordered * line.unitCents),
    0,
  );
  return (
    <section className="warehouse-section">
      <WarehouseBack href="#inventory/compras">
        Volver a recepción de compras
      </WarehouseBack>
      <header className="accounting-section-head">
        <div>
          <h2>{row.supplier || "Pedido por preparar"}</h2>
          <p className="hint">
            {row.workName || "Almacén general"} · {date(row.createdAt)} ·{" "}
            {row.actor}
          </p>
        </div>
        <div className="accounting-tools">
          <span
            className="ops-stock-status warehouse-order-status"
            data-state={row.status}
          >
            {purchaseStatus[row.status]}
          </span>
        </div>
      </header>
      {row.status === "requested" && (
        <PurchasePreparation
          accountingAccess={accountingWrite}
          purchaseId={row.id}
        />
      )}
      <div
        className="purchase-tabs"
        role="tablist"
        aria-label="Detalle de la compra"
      >
        {detailTabs.map(({ id, label }, index) => (
          <button
            type="button"
            key={id}
            id={`${tabId}-tab-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`${tabId}-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
            onKeyDown={(event) => {
              const last = detailTabs.length - 1;
              const destinations: Partial<Record<string, number>> = {
                ArrowRight: (index + 1) % detailTabs.length,
                ArrowLeft: (index + last) % detailTabs.length,
                Home: 0,
                End: last,
              };
              const next = destinations[event.key];
              if (next === undefined) return;
              event.preventDefault();
              const nextId = detailTabs[next].id;
              setActiveTab(nextId);
              document.getElementById(`${tabId}-tab-${nextId}`)?.focus();
            }}
          >
            {label}
            {id === "receipts" && appliedReceipts.length > 0 && (
              <span aria-hidden="true">{appliedReceipts.length}</span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-materials`}
        aria-labelledby={`${tabId}-tab-materials`}
        hidden={activeTab !== "materials"}
      >
        {row.items.length > 0 && (
          <section className="warehouse-panel purchase-materials">
            <div>
              <h3>Materiales del pedido</h3>
              {targets.size > 0 && (
                <p className="hint">
                  {canReceive
                    ? "Selecciona el material que llegó."
                    : "Pendiente de recepción en Almacén."}
                </p>
              )}
            </div>
            <ul className="warehouse-list warehouse-detail-list">
              {items.map((item) => {
                const target = targets.get(item.materialId);
                return (
                  <li key={item.materialId}>
                    <div>
                      <strong>
                        {item.sku} · {item.name}
                      </strong>
                      {target && (
                        <p className="purchase-remaining">
                          Por recibir{" "}
                          <strong>
                            {amount(remainingQuantity(item))}{" "}
                            {unitName(item.unit)}
                          </strong>
                        </p>
                      )}
                      <small>{item.reason}</small>
                      <small>
                        Solicitado {amount(item.requested)}{" "}
                        {unitName(item.unit)}
                        {row.supplier && (
                          <>
                            {" "}
                            · Pedido {amount(item.ordered)} · Recibido{" "}
                            {amount(item.received)} {unitName(item.unit)} ·{" "}
                            {money(item.unitCents)} por unidad
                          </>
                        )}
                      </small>
                    </div>
                    {canReceive && target && (
                      <Button
                        type="button"
                        onClick={() => setReceiving(target)}
                      >
                        <PackageCheck size={16} aria-hidden="true" />
                        {target.pending
                          ? "Continuar recepción"
                          : "Confirmar recepción"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {row.items.length === 0 && (
          <p className="hint">Contabilidad aún debe indicar los materiales.</p>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-receipts`}
        aria-labelledby={`${tabId}-tab-receipts`}
        hidden={activeTab !== "receipts"}
      >
        <section className="warehouse-panel">
          <h3>Materiales recibidos</h3>
          {appliedReceipts.length > 0 ? (
            <ul className="warehouse-list">
              {appliedReceipts.map((receipt) => (
                <li key={receipt.operationId}>
                  <div>
                    <strong>
                      {receipt.reference || "Recepción sin documento"} ·{" "}
                      {amount(receipt.quantity)}{" "}
                      {unitName(
                        row.items.find(
                          (line) => line.materialId === receipt.materialId,
                        )?.unit || "",
                      )}
                    </strong>
                    <small>
                      {
                        row.items.find(
                          (line) => line.materialId === receipt.materialId,
                        )?.name
                      }{" "}
                      · {date(receipt.at)} · {receipt.actor}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Aún no hay recepciones registradas.</p>
          )}
        </section>
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-details`}
        aria-labelledby={`${tabId}-tab-details`}
        hidden={activeTab !== "details"}
      >
        <div className="warehouse-preview">
          {row.invoiceSource ? (
            <>
              <strong>
                Factura {row.invoiceSource.reference || "por identificar"} ·{" "}
                {money(row.invoiceSource.netCents)} sin IGV
              </strong>
              <p>
                Factura enviada por Contabilidad para este pedido de materiales.
              </p>
            </>
          ) : (
            <>{row.supplier && <strong>{money(total)} sin IGV</strong>}</>
          )}
          {row.requestedAt && row.requestedBy && (
            <small>
              Solicitado el {date(row.requestedAt)} por {row.requestedBy}
            </small>
          )}
          <p>{row.reason}</p>
          {["open", "partial", "received"].includes(row.status) &&
            (accountingAccess ? (
              <a
                className="warehouse-link"
                href={`#accounting/gastos/${row.id}`}
              >
                Ver o registrar factura en Contabilidad
              </a>
            ) : (
              <p className="hint">
                La factura de este pedido se registra y revisa en Contabilidad.
              </p>
            ))}
        </div>
      </div>
      {canReceive && receiving && (
        <ReceiveForm
          row={row}
          {...receiving}
          close={() => setReceiving(undefined)}
          done={() => {
            setReceiving(undefined);
            setActiveTab("receipts");
            refresh();
            requestAnimationFrame(() =>
              document.getElementById(`${tabId}-tab-receipts`)?.focus(),
            );
          }}
        />
      )}
    </section>
  );
}

function ReceiveForm({
  row,
  item,
  pending,
  close,
  done,
}: {
  row: Purchase;
  item: Item;
  pending?: Receipt;
  close: () => void;
  done: () => void;
}) {
  const operation = useRef(pending?.operationId || crypto.randomUUID());
  const remaining = remainingQuantity(item);
  return (
    <WarehouseForm
      title={
        pending ? "Continuar recepción" : "Confirmar recepción de material"
      }
      action="Confirmar recepción"
      onClose={close}
      save={async (form) => {
        await postWarehouse(path + `/${row.id}/receive`, {
          operationId: operation.current,
          materialId: item.materialId,
          quantity: Number(form.get("quantity")),
          reference: stringField(form, "reference"),
        });
        done();
      }}
    >
      <div className="warehouse-preview">
        <strong>
          {item.sku} · {item.name}
        </strong>
        <p>
          Por recibir: {amount(remaining)} {unitName(item.unit)}
        </p>
      </div>
      <p className="hint">El stock aumenta con la cantidad que confirmes.</p>
      <Field label="Cantidad recibida">
        <input
          name="quantity"
          type="number"
          step="0.001"
          min="0.001"
          max={remaining}
          defaultValue={pending?.quantity ?? remaining}
          required
          readOnly={Boolean(pending)}
        />
      </Field>
      <Field label="Guía o documento de entrega (opcional)">
        <input
          name="reference"
          maxLength={100}
          placeholder="Ej.: T001-000185"
          defaultValue={pending?.reference}
          readOnly={Boolean(pending)}
        />
      </Field>
    </WarehouseForm>
  );
}
