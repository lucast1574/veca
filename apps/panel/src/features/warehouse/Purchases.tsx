import { Select } from "@veca/ui/src/Select";
import { useRef, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
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
        Contabilidad registra lo comprado, las cantidades y los precios. Aquí
        confirma qué materiales llegaron y su cantidad real para actualizar el
        stock.
      </p>
      <div className="accounting-filters">
        <Field label="Buscar pedidos">
          <input
            type="search"
            placeholder="Proveedor, obra o material"
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
      <QueryState
        {...list}
        empty={
          search || status
            ? "No hay pedidos con estos filtros. Prueba otro estado o proveedor."
            : "Aún no hay pedidos. Aquí aparecerán los materiales solicitados por las obras o derivados desde Contabilidad."
        }
      >
        {Boolean(list.data?.items.length) && (
          <ul className="warehouse-list">
            {list.data?.items.map((row) => (
              <li key={row.id}>
                <ClipboardList size={19} aria-hidden="true" />
                <div>
                  <a href={`#inventory/compras/${row.id}`}>
                    <strong>{row.supplier || "Pedido por preparar"}</strong>
                  </a>
                  <small>
                    {row.workName || "Almacén general"} · {date(row.createdAt)}
                  </small>
                </div>
                <span
                  className="ops-stock-status warehouse-order-status"
                  data-state={row.status}
                >
                  {row.invoiceSource && row.status === "requested"
                    ? "Por completar en Contabilidad"
                    : purchaseStatus[row.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <Pagination
        page={page}
        hasMore={Boolean(list.data?.hasMore)}
        change={setPage}
      />
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
  return (
    <WarehouseForm
      title="Solicitar pedido para la obra"
      action="Enviar solicitud"
      wide
      onClose={close}
      save={async (form) => {
        const payload = purchaseRequest.safeParse({
          id: id.current,
          workId,
          reason: stringField(form, "reason"),
          materials: rows.map((row) => ({
            materialId: row.materialId,
            quantity: Number(form.get(row.key)),
          })),
        });
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
  const [receiving, setReceiving] = useState<{
    item: Item;
    pending?: Receipt;
  }>();
  const total = row.items.reduce(
    (sum, line) => sum + Math.round(line.ordered * line.unitCents),
    0,
  );
  return (
    <section className="warehouse-section">
      <a href="#inventory/compras" className="warehouse-link">
        Volver a pedidos y recepciones
      </a>
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
            {row.invoiceSource && row.status === "requested"
              ? "Por completar en Contabilidad"
              : purchaseStatus[row.status]}
          </span>
        </div>
      </header>
      {row.status === "requested" && (
        <PurchasePreparation
          accountingAccess={accountingWrite}
          purchaseId={row.id}
        />
      )}
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
          <>
            {row.supplier && <strong>{money(total)} sin IGV</strong>}
            <p>
              Revisa los materiales del pedido y registra las cantidades que
              llegan. Cada recepción confirmada aumenta el stock disponible.
            </p>
          </>
        )}
        {row.supplier && row.requestedAt && (
          <small>
            Solicitado el {date(row.requestedAt)} por {row.requestedBy}
          </small>
        )}
        <p>{row.reason}</p>
        {["open", "partial", "received"].includes(row.status) &&
          (accountingAccess ? (
            <a className="warehouse-link" href={`#accounting/gastos/${row.id}`}>
              Ver o registrar factura en Contabilidad
            </a>
          ) : (
            <p className="hint">
              La factura de este pedido se registra y revisa en Contabilidad.
            </p>
          ))}
      </div>
      {row.items.length > 0 && (
        <section className="warehouse-panel">
          <div>
            <h3>Materiales del pedido</h3>
            {canReceive && ["open", "partial"].includes(row.status) && (
              <p className="hint">
                Usa Confirmar recepción en el material que llegó. Puedes
                confirmar entregas parciales.
              </p>
            )}
          </div>
          <ul className="warehouse-list warehouse-detail-list">
            {row.items.map((item) => {
              const pending = row.receipts.find(
                (receipt) =>
                  receipt.materialId === item.materialId && !receipt.applied,
              );
              return (
                <li key={item.materialId}>
                  <div>
                    <strong>
                      {item.sku} · {item.name}
                    </strong>
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
                  {canReceive &&
                    row.status !== "cancelled" &&
                    item.received + 0.0001 < item.ordered && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setReceiving({ item, pending })}
                      >
                        {pending
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
                      {receipt.reference} · {amount(receipt.quantity)}{" "}
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
      {receiving && (
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
  const remaining = Math.round((item.ordered - item.received) * 1000) / 1000;
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
      <Field label="Guía, comprobante o referencia de la entrega">
        <input
          name="reference"
          maxLength={100}
          required
          defaultValue={pending?.reference}
          readOnly={Boolean(pending)}
        />
      </Field>
    </WarehouseForm>
  );
}
