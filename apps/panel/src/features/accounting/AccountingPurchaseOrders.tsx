import { useEffect, useState } from "react";
import { ArrowRight, ClipboardList } from "lucide-react";
import type { Material, Purchase } from "@veca/content";
import { Button, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import {
  accountingPath,
  accountingPost,
  amount,
  Pagination,
  QueryState,
  useAccountingQuery,
} from "./accounting-shared";
import { PurchaseOrderDialog, purchaseOrdersPath } from "./PurchaseOrderDialog";
import {
  WarehouseForm,
  purchaseStatus,
  type WorkOption,
} from "../warehouse/shared";
import { amount as quantity, unitName } from "../operations/shared";

export function AccountingPurchaseOrders({
  selected,
  onSelect,
  onClose,
  onSaved,
  canWrite,
  revision = 0,
  purchaseId,
}: {
  selected?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSaved: () => void;
  canWrite: boolean;
  revision?: number;
  purchaseId?: string;
}) {
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<Purchase>();
  const [completed, setCompleted] = useState<Purchase>();
  const list = useAccountingQuery<{ items: Purchase[]; hasMore: boolean }>(
    purchaseId ? "" : `${purchaseOrdersPath}?page=${page}`,
  );
  const specific = useAccountingQuery<Purchase>(
    purchaseId ? `${purchaseOrdersPath}/${purchaseId}` : "",
  );
  useEffect(() => {
    list.refresh();
    specific.refresh();
  }, [revision]);
  useEffect(() => {
    const timer = setInterval(() => {
      list.refresh();
      specific.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [list.refresh, specific.refresh]);
  const items = purchaseId
    ? specific.data?.status === "requested"
      ? [specific.data]
      : []
    : list.data?.items || [];
  const error = purchaseId ? specific.error : list.error;
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      {completed && (
        <Notice>
          Compra completada y lista para que Almacén confirme la entrega física.{" "}
          {!completed.invoiceSource && (
            <a href={`#accounting/gastos/${completed.id}`}>
              Registrar el comprobante
            </a>
          )}
        </Notice>
      )}
      {specific.data && specific.data.status !== "requested" && (
        <section className="accounting-purchase-orders warehouse-panel">
          <PurchaseSummary order={specific.data} />
          {canWrite &&
            specific.data.status === "open" &&
            !specific.data.receipts.length && (
              <div className="warehouse-detail-secondary">
                <Button
                  variant="ghost"
                  onClick={() => setCancelling(specific.data)}
                >
                  Cancelar pedido
                </Button>
              </div>
            )}
        </section>
      )}

      {items.length > 0 && (
        <section
          className="accounting-purchase-orders accounting-purchase-queue warehouse-panel"
          aria-labelledby="accounting-purchase-orders-heading"
        >
          <header className="accounting-section-head">
            <h3 id="accounting-purchase-orders-heading">
              Compras por preparar
            </h3>
            <span
              className="ops-stock-status warehouse-order-status"
              data-state="requested"
            >
              {items.length} {items.length === 1 ? "pendiente" : "pendientes"}
            </span>
          </header>
          <ul className="warehouse-records">
            {items.map((row) => (
              <li key={row.id} className="purchase-card">
                <header>
                  <h4>
                    <ClipboardList size={17} aria-hidden="true" />
                    {row.supplier || "Solicitud de compra"}
                  </h4>
                  <span className="purchase-destination">
                    Destino · {row.workName || "Almacén general"}
                  </span>
                </header>
                <div className="accounting-purchase-context">
                  {row.invoiceSource && (
                    <small>
                      Factura {row.invoiceSource.reference || "sin número"}
                    </small>
                  )}
                  {row.reason && <small>{row.reason}</small>}
                </div>
                <div className="purchase-step">
                  <strong>
                    {canWrite
                      ? "Registra materiales, cantidades y precios."
                      : "Pendiente de Contabilidad"}
                  </strong>
                  {canWrite && (
                    <Button type="button" onClick={() => onSelect(row.id)}>
                      Completar compra{" "}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {canWrite && (
                  <button
                    type="button"
                    className="warehouse-link accounting-purchase-cancel"
                    onClick={() => setCancelling(row)}
                  >
                    Cancelar pedido
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!purchaseId && (
            <Pagination
              page={page}
              hasMore={Boolean(list.data?.hasMore)}
              change={setPage}
            />
          )}
        </section>
      )}
      {cancelling && (
        <WarehouseForm
          title="Cancelar pedido de materiales"
          action="Confirmar cancelación"
          onClose={() => setCancelling(undefined)}
          save={async () => {
            await accountingPost(
              `${purchaseOrdersPath}/${cancelling.id}/cancel`,
              {},
            );
            setCancelling(undefined);
            list.refresh();
            specific.refresh();
            onSaved();
          }}
        >
          <p>
            El pedido quedará cancelado en el historial.
            {cancelling.invoiceSource &&
              " La factura seguirá guardada en Contabilidad."}
          </p>
        </WarehouseForm>
      )}
      {selected && canWrite && (
        <PreparationDialog
          key={selected}
          id={selected}
          close={onClose}
          saved={(row) => {
            setCompleted(row);
            onClose();
            list.refresh();
            specific.refresh();
            onSaved();
          }}
        />
      )}
    </>
  );
}
function PreparationDialog({
  id,
  close,
  saved,
}: {
  id: string;
  close: () => void;
  saved: (row: Purchase) => void;
}) {
  const order = useAccountingQuery<Purchase>(`${purchaseOrdersPath}/${id}`);
  const materials = useAccountingQuery<Material[]>(
    accountingPath + "/purchase-materials",
  );
  const works = useAccountingQuery<WorkOption[]>(
    accountingPath + "/purchase-works",
  );
  if (!order.data || materials.loading || works.loading)
    return (
      <Modal title="Completar compra de materiales" onClose={close}>
        <QueryState
          {...order}
          loading={order.loading || materials.loading || works.loading}
        />
      </Modal>
    );
  if (order.data.status !== "requested")
    return (
      <Modal title="Detalle de la compra" onClose={close}>
        <p>
          {order.data.status === "cancelled"
            ? "Este pedido está cancelado. Su historial y la factura se conservan."
            : "El detalle comprado ya está registrado. Las cantidades recibidas se confirman desde Almacén."}
        </p>
        <PurchaseSummary order={order.data} />
        <Button onClick={close}>Cerrar</Button>
      </Modal>
    );
  return (
    <PurchaseOrderDialog
      requested={order.data}
      materials={materials.data || []}
      works={works.data || []}
      initialWork={order.data.workId}
      loadError={materials.error || works.error}
      close={close}
      done={saved}
    />
  );
}

function PurchaseSummary({ order }: { order: Purchase }) {
  return (
    <section className="warehouse-panel">
      <div className="accounting-section-head">
        <div>
          <h3>Materiales de la compra</h3>
          <span className="purchase-destination">
            Destino · {order.workName || "Almacén general"}
          </span>
        </div>
        <span className="ops-stock-status">{purchaseStatus[order.status]}</span>
      </div>
      <ul className="warehouse-list">
        {order.items.map((item) => (
          <li key={item.materialId}>
            <div>
              <strong>
                {item.sku} · {item.name}
              </strong>
              <small>
                Comprado: {quantity(item.ordered)} {unitName(item.unit)} ·
                Precio unitario: {amount(item.unitCents)} sin IGV
              </small>
              <small>
                Confirmado por Almacén: {quantity(item.received)}{" "}
                {unitName(item.unit)}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function PurchaseCostDetail({ id }: { id: string }) {
  const query = useAccountingQuery<Purchase>(`${purchaseOrdersPath}/${id}`);
  return (
    <QueryState {...query}>
      {query.data && (
        <>
          <PurchaseSummary order={query.data} />
          <a
            className="warehouse-link"
            href={`#accounting/gastos/${id}${query.data.status === "requested" ? "/preparar" : ""}`}
          >
            {query.data.status === "requested"
              ? "Completar materiales y precios"
              : "Ver detalle de la compra"}
          </a>
        </>
      )}
    </QueryState>
  );
}
