import { Select } from "@veca/ui/src/Select";
import { useRef, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import {
  purchaseInput,
  purchaseRequest,
  type Purchase,
  type Material,
} from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
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
  PickWork,
  postWarehouse,
  putWarehouse,
  purchaseStatus,
  stringField,
  useWarehouseMaterials,
  useWarehouseWorks,
  warehousePath,
  WarehouseForm,
  WarehouseSelect,
  type WorkOption,
} from "./shared";

const path = warehousePath + "/purchases";
type Item = Purchase["items"][number];
type Receipt = Purchase["receipts"][number];

export function Purchases({
  selected,
  workId = "",
  accountingAccess = false,
  canManage = false,
  canReceive = false,
}: {
  selected?: string;
  workId?: string;
  accountingAccess?: boolean;
  canManage?: boolean;
  canReceive?: boolean;
}) {
  const [create, setCreate] = useState(false);
  const [requesting, setRequesting] = useState(Boolean(workId));
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
  const works = useWarehouseWorks();
  const query = useAccountingQuery<Purchase>(
    selected ? `${path}/${selected}` : "",
  );
  if (selected)
    return (
      <QueryState {...query}>
        {query.data && (
          <PurchaseDetail
            row={query.data}
            materials={materials.data || []}
            materialsError={materials.error}
            refresh={query.refresh}
            accountingAccess={accountingAccess}
            canManage={canManage}
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
          {canManage && (
            <Button type="button" onClick={() => setCreate(true)}>
              <Plus size={16} /> Nuevo pedido
            </Button>
          )}
        </div>
      </header>
      <p className="hint">
        Organiza los pedidos de materiales y registra lo recibido para
        actualizar el stock. Las facturas se gestionan en Contabilidad, en
        Compras y gastos.
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
                <span className="ops-stock-status">
                  {row.invoiceSource && row.status === "requested"
                    ? "Identificar materiales"
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
      {create && (
        <PurchaseForm
          materials={materials.data || []}
          works={works.data || []}
          initialWork={workId}
          loadError={materials.error || works.error}
          close={() => setCreate(false)}
          done={(row) => {
            setCreate(false);
            location.hash = `inventory/compras/${row.id}`;
          }}
        />
      )}
    </section>
  );
}

function PurchaseForm({
  materials,
  works,
  initialWork,
  requested,
  loadError,
  close,
  done,
}: {
  materials: Material[];
  works: WorkOption[];
  initialWork: string;
  requested?: Purchase;
  loadError?: string;
  close: () => void;
  done: (row: Purchase) => void;
}) {
  const editableLines = !requested || Boolean(requested.invoiceSource);
  const [work, setWork] = useState(initialWork);
  const newLine = () => ({
    key: crypto.randomUUID(),
    materialId: "",
    requested: 0,
    label: "",
  });
  const [lines, setLines] = useState(() =>
    requested?.items.length
      ? requested.items.map((item) => ({
          key: item.materialId,
          materialId: item.materialId,
          requested: item.requested,
          label: `${item.sku} · ${item.name}`,
        }))
      : [newLine()],
  );
  const id = useRef(requested?.id || recordId());
  return (
    <WarehouseForm
      title={
        requested?.invoiceSource
          ? "Preparar recepción de materiales"
          : requested
            ? "Preparar pedido de materiales"
            : "Nuevo pedido de materiales"
      }
      action={
        requested?.invoiceSource ? "Guardar materiales" : "Guardar pedido"
      }
      wide
      onClose={close}
      save={async (form) => {
        const parsed = purchaseInput.safeParse({
          id: id.current,
          workId: work,
          supplier: stringField(form, "supplier"),
          supplierRuc: stringField(form, "ruc"),
          reason: requested?.reason || stringField(form, "reason"),
          items: lines.map((item) => ({
            materialId: item.materialId,
            requested: requested
              ? item.requested
              : Number(form.get(item.key + "-requested")),
            ordered: Number(form.get(item.key + "-ordered")),
            unitCents: Math.round(Number(form.get(item.key + "-cost")) * 100),
            reason:
              stringField(form, item.key + "-reason") ||
              stringField(form, "reason"),
          })),
        });
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          if (!issue.path.length) throw new Error(issue.message);
          throw new Error(
            "Revisa el proveedor, los códigos, las cantidades y el costo unitario.",
          );
        }
        done(
          requested
            ? await putWarehouse<Purchase>(
                `${path}/${requested.id}/order`,
                parsed.data,
              )
            : await postWarehouse<Purchase>(path, parsed.data),
        );
      }}
    >
      {requested?.invoiceSource && (
        <Notice>
          Factura enviada por Contabilidad:{" "}
          {requested.invoiceSource.reference || "sin número de factura"}.
          Identifica los materiales y distribuye{" "}
          {money(requested.invoiceSource.netCents)} sin IGV. Después registra lo
          recibido cuando llegue físicamente.
        </Notice>
      )}
      {!requested?.invoiceSource && (
        <p className="hint">
          Indica el proveedor, los materiales y las cantidades del pedido.
          Guardarlo no aumenta el stock: registra la recepción cuando lleguen.
          La factura se gestiona en Contabilidad.
        </p>
      )}
      {loadError && <Notice error>{loadError}</Notice>}
      <div className="warehouse-grid">
        {!requested && (
          <PickWork
            works={works}
            value={work}
            onChange={setWork}
            allowGeneral
          />
        )}
        <Field label="Proveedor">
          <input
            name="supplier"
            required
            maxLength={150}
            defaultValue={requested?.supplier}
            readOnly={Boolean(requested?.invoiceSource)}
          />
        </Field>
        <Field label="RUC del proveedor (opcional)">
          <input
            name="ruc"
            defaultValue={requested?.supplierRuc}
            readOnly={Boolean(requested?.invoiceSource)}
            pattern="[0-9]{11}"
            maxLength={11}
            inputMode="numeric"
          />
        </Field>
        {!requested && (
          <Field label="Motivo del pedido">
            <input name="reason" required maxLength={500} />
          </Field>
        )}
      </div>
      <div className="warehouse-lines">
        {lines.map((line, index) => (
          <div className="warehouse-line" key={line.key}>
            <header>
              <strong>
                {!editableLines ? line.label : `Material ${index + 1}`}
              </strong>
              {editableLines && lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Quitar material ${index + 1}`}
                  onClick={() =>
                    setLines((current) =>
                      current.filter((row) => row.key !== line.key),
                    )
                  }
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </header>
            {editableLines && (
              <WarehouseSelect
                label="Código o material"
                value={line.materialId}
                options={materialOptions(materials)}
                onChange={(materialId) =>
                  setLines((current) =>
                    current.map((row) =>
                      row.key === line.key ? { ...row, materialId } : row,
                    ),
                  )
                }
              />
            )}
            <div className="warehouse-grid is-3">
              {!requested?.invoiceSource && (
                <Field label="Cantidad solicitada">
                  <input
                    name={line.key + "-requested"}
                    readOnly={Boolean(requested)}
                    defaultValue={requested ? line.requested : undefined}
                    type="number"
                    required
                    min="0"
                    step="0.001"
                  />
                </Field>
              )}
              <Field label="Cantidad pedida">
                <input
                  name={line.key + "-ordered"}
                  type="number"
                  required
                  min="0.001"
                  step="0.001"
                />
              </Field>
              <Field label="Costo unitario sin IGV">
                <input
                  name={line.key + "-cost"}
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                />
              </Field>
            </div>
            <Field label="Motivo de esta cantidad">
              <input
                name={line.key + "-reason"}
                required
                maxLength={500}
                defaultValue={
                  requested?.invoiceSource ? requested.reason : undefined
                }
              />
            </Field>
          </div>
        ))}
      </div>
      {editableLines && (
        <Button
          type="button"
          variant="ghost"
          disabled={lines.length >= 40}
          onClick={() => setLines((current) => [...current, newLine()])}
        >
          <Plus size={16} /> Añadir material
        </Button>
      )}
    </WarehouseForm>
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
  materials,
  materialsError,
  refresh,
  accountingAccess,
  canManage,
  canReceive,
}: {
  row: Purchase;
  materials: Material[];
  materialsError?: string;
  refresh: () => void;
  accountingAccess: boolean;
  canManage: boolean;
  canReceive: boolean;
}) {
  const [receiving, setReceiving] = useState<{
    item: Item;
    pending?: Receipt;
  }>();
  const [cancel, setCancel] = useState(false);
  const [ordering, setOrdering] = useState(false);
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
          <span className="ops-stock-status">
            {row.invoiceSource && row.status === "requested"
              ? "Identificar materiales"
              : purchaseStatus[row.status]}
          </span>
          {canManage && row.status === "requested" && (
            <Button type="button" onClick={() => setOrdering(true)}>
              {row.invoiceSource ? "Preparar recepción" : "Preparar pedido"}
            </Button>
          )}
        </div>
      </header>
      <div className="warehouse-preview">
        {row.invoiceSource ? (
          <>
            <strong>
              Factura {row.invoiceSource.reference || "por identificar"} ·{" "}
              {money(row.invoiceSource.netCents)} sin IGV
            </strong>
            <p>
              Contabilidad envió esta factura a Almacén. Identifica los
              materiales y confirma su recepción cuando lleguen. La factura ya
              está guardada; no necesitas registrarla otra vez.
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
                    {pending ? "Continuar recepción" : "Registrar recepción"}
                  </Button>
                )}
            </li>
          );
        })}
      </ul>
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
      {canManage &&
        ["open", "requested"].includes(row.status) &&
        !row.receipts.length && (
          <Button type="button" variant="ghost" onClick={() => setCancel(true)}>
            Cancelar pedido
          </Button>
        )}
      {ordering && (
        <PurchaseForm
          materials={materials}
          loadError={materialsError}
          works={[]}
          initialWork={row.workId}
          requested={row}
          close={() => setOrdering(false)}
          done={() => {
            setOrdering(false);
            refresh();
          }}
        />
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
      {cancel && (
        <WarehouseForm
          title="Cancelar pedido"
          action="Confirmar cancelación"
          onClose={() => setCancel(false)}
          save={async () => {
            await postWarehouse(path + `/${row.id}/cancel`, {});
            setCancel(false);
            refresh();
          }}
        >
          <p className="hint">
            El pedido quedará cancelado y se conservará en el historial. La
            factura vinculada, si la tiene, se conserva en Contabilidad.
          </p>
        </WarehouseForm>
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
        pending ? "Continuar recepción" : "Registrar recepción de material"
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
