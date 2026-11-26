import { Select } from "@veca/ui/src/Select";
import { useRef, useState } from "react";
import {
  ClipboardList,
  Plus,
  Trash2,
  PackageCheck,
  ChevronDown,
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
    <li className="purchase-card">
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
            <>
              <strong>Siguiente paso · Contabilidad</strong>
              <p>
                Debe completar el pedido con materiales, cantidades y precios.
              </p>
            </>
          ) : receiving ? (
            <>
              <strong>Siguiente paso · Almacén</strong>
              <p>
                {resuming
                  ? "Hay una recepción por terminar."
                  : "Cuando llegue el material, registra la cantidad que recibiste."}
              </p>
              <ul
                className="purchase-pending"
                aria-label="Materiales por recibir"
              >
                {targets.slice(0, 2).map(({ item }) => (
                  <li key={item.materialId}>
                    Por recibir{" "}
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
      <header className="accounting-section-head">
        <h2 id="purchase-heading">Pedidos y recepciones</h2>
        <div className="accounting-tools">
          <Refresh loading={list.loading} onClick={list.refresh} />
        </div>
      </header>
      <p className="hint">
        {canReceive
          ? "Cuando llegue un pedido del proveedor, registra lo recibido para actualizar el stock."
          : "Consulta qué pedidos prepara Contabilidad y qué materiales recibió Almacén."}
      </p>
      <div className="warehouse-filters is-two">
        <Field label="Buscar pedidos">
          <input
            type="search"
            placeholder="Proveedor, factura, obra o material"
            maxLength={100}
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </Field>
        <Select
          label="Estado del pedido"
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={[
            { value: "", label: "Todos los estados" },
            ...Object.entries(purchaseStatus).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
      </div>
      {receivedMessage && <Notice>{receivedMessage}</Notice>}
      <QueryState
        {...list}
        empty={
          search || status
            ? "No hay pedidos con estos filtros. Prueba otro estado o proveedor."
            : "Aún no hay pedidos. Aquí aparecerán los materiales solicitados por las obras o derivados desde Contabilidad."
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
        Volver a pedidos y recepciones
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
      {row.items.length > 0 && (
        <section className="warehouse-panel purchase-materials">
          <div>
            <h3>Materiales del pedido</h3>
            {targets.size > 0 && (
              <p className="hint">
                {canReceive
                  ? "Almacén · Elige el material que llegó y registra su cantidad. Si falta algo, quedará pendiente."
                  : "Almacén registrará las cantidades cuando llegue el material."}
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
                      Solicitado {amount(item.requested)} {unitName(item.unit)}
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
                    <Button type="button" onClick={() => setReceiving(target)}>
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
      {row.receipts.some((receipt) => receipt.applied) && (
        <section className="warehouse-panel">
          <h3>Materiales recibidos</h3>
          <ul className="warehouse-list">
            {row.receipts
              .filter((receipt) => receipt.applied)
              .map((receipt) => (
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
        </section>
      )}
      <details className="supply-tracking purchase-details">
        <summary>
          Datos del pedido <ChevronDown size={15} aria-hidden="true" />
        </summary>
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
      </details>
      {canReceive && receiving && (
        <ReceiveForm
          row={row}
          {...receiving}
          close={() => setReceiving(undefined)}
          done={() => {
            setReceiving(undefined);
            refresh();
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
      <p className="hint">
        Registra solo la cantidad que llegó físicamente. Al confirmar, se sumará
        al stock. Si falta material, el pedido seguirá pendiente.
      </p>
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
      <Field
        label="Número de guía o documento de entrega (opcional)"
        hint="Si el proveedor no entregó un documento, puedes dejarlo vacío."
      >
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
