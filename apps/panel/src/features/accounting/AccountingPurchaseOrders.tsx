import { useEffect, useState } from "react";
import { ArrowRight, Package } from "lucide-react";
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
          className="sire-inbox accounting-purchase-orders"
          aria-labelledby="accounting-purchase-orders-heading"
        >
          <header className="accounting-section-head">
            <div>
              <h3 id="accounting-purchase-orders-heading">
                Materiales por completar
              </h3>
            </div>
            <span className="ops-stock-status">
              {items.length} por completar
            </span>
          </header>
          <ul className="warehouse-list">
            {items.map((row) => (
              <li key={row.id}>
                <Package size={18} aria-hidden="true" />
                <div>
                  <strong>{row.supplier || "Solicitud de compra"}</strong>
                  <span className="purchase-destination">
                    Destino · {row.workName || "Almacén general"}
                  </span>
                  {row.invoiceSource && (
                    <small>
                      Factura {row.invoiceSource.reference} ya guardada
                    </small>
                  )}
                  <small>{row.reason}</small>
                </div>
                {canWrite && (
                  <div className="supply-actions">
                    <Button type="button" onClick={() => onSelect(row.id)}>
                      Completar compra{" "}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setCancelling(row)}
                    >
                      Cancelar pedido
                    </Button>
                  </div>
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
            El pedido quedará cancelado y se conservará en el historial. La
            factura guardada en Contabilidad se conserva.
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
