import { useRef, useState } from "react";
import { Plus, Package, Truck, ChevronDown } from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import {
  DISPATCH_STATUS,
  supplyActionLabels,
  type SessionUser,
  type SupplyRequest,
  type SupplyAction,
} from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import {
  QueryState,
  recordId,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { amount, unitName, useLiveRefresh } from "../operations/shared";
import { WarehouseForm, WarehouseBack, stringField } from "./shared";
import "./warehouse.css";
type MaterialOption = { id: string; name: string; sku: string; unit: string };
const actionPermissions = {
  reserve: "inventory_reserve",
  cancel: "inventory_reserve",
  deliver: "inventory_dispatch",
  accept_return: "inventory_receive",
  purchase: "inventory_request",
} as const;
function actions(
  row: SupplyRequest,
  user: SessionUser,
): SupplyAction["action"][] {
  if (row.pending) {
    const action = row.pending.action;
    return user.permissions.includes("inventory") &&
      action in actionPermissions &&
      user.permissions.includes(
        actionPermissions[action as keyof typeof actionPermissions],
      )
      ? [action]
      : [];
  }
  const offered: SupplyAction["action"][] = [];
  if (user.permissions.includes("inventory")) {
    if (!row.cancelled && row.delivered < row.quantity) offered.push("reserve");
    if (!row.cancelled && row.delivered < row.quantity) offered.push("cancel");
    if (!row.cancelled && row.reserved > 0) offered.push("deliver");
    if (row.returnRequested > 0) offered.push("accept_return");
    if (
      !row.cancelled &&
      !row.purchaseId &&
      row.quantity - row.delivered - row.reserved > 0
    )
      offered.push("purchase");
  }
  return offered.filter(
    (action) =>
      action in actionPermissions &&
      user.permissions.includes(
        actionPermissions[action as keyof typeof actionPermissions],
      ),
  );
}

export function SupplyRequests({
  user,
  workId,
  selected: selectedId,
}: {
  user: SessionUser;
  workId?: string;
  selected?: string;
}) {
  const path = workId
    ? `/admin/works/${workId}/supplies`
    : selectedId
      ? `/admin/supply-requests/${selectedId}`
      : "/admin/supply-requests";
  const [page, setPage] = useState(1);
  const [guide, setGuide] = useState<SupplyRequest>();
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState(workId ? "all" : "open");
  const query = useAccountingQuery<{
    items: SupplyRequest[];
    hasMore: boolean;
  }>(`${path}?page=${page}&filter=${filter}`);
  useLiveRefresh(
    query.refresh,
    false,
    true,
    workId ? "/admin/works/events" : "/admin/crm/events",
  );
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<{
    row: SupplyRequest;
    action: SupplyAction["action"];
  }>();
  const report =
    workId &&
    user.permissions.some((p) => p === "works_report" || p === "works_manage");
  const canRequest =
    workId &&
    user.permissions.some(
      (p) => p === "inventory_request" || p === "works_manage",
    );
  return (
    <section className="ops-card supply-requests">
      <header className="lead-detail-section-head">
        <h2>Solicitudes a Almacén</h2>
        {canRequest && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} /> Solicitar material
          </Button>
        )}
      </header>
      {selectedId && (
        <WarehouseBack href="#inventory/solicitudes">
          Ver todas las solicitudes
        </WarehouseBack>
      )}
      <div className="accounting-tools supply-filters">
        <Select
          label="Mostrar solicitudes"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          options={[
            { value: "open", label: "Por atender" },
            { value: "all", label: "Todas las solicitudes" },
          ]}
        />
      </div>
      <p className="hint">
        Las obras indican qué necesitan y para cuándo. Reserva el material
        disponible y solicita la guía antes de confirmar su salida.
      </p>
      {message && (
        <p className="warehouse-message" role="status">
          {message}
        </p>
      )}
      {guide && (
        <WarehouseForm
          title="Solicitar guía de remisión"
          action="Enviar solicitud a Contabilidad"
          onClose={() => setGuide(undefined)}
          save={async (form) => {
            await api(`/admin/supply-requests/${guide.id}/guide-request`, {
              method: "POST",
              body: JSON.stringify({
                version: guide.version,
                transferAt: stringField(form, "transferAt"),
              }),
            });
            setGuide(undefined);
            setMessage(
              "Solicitud enviada a Contabilidad. Cuando la guía esté aceptada, podrás confirmar la salida.",
            );
            query.refresh();
          }}
        >
          <div className="warehouse-preview">
            <strong>{guide.materialName}</strong>
            <p>
              {guide.workName} · {amount(guide.reserved)} {unitName(guide.unit)}{" "}
              reservados
            </p>
          </div>
          <p>
            Contabilidad recibirá una solicitud con este material y su cantidad
            reservada. Completará los datos del transporte y revisará la guía
            antes de emitirla.
          </p>
          <Field label="Fecha y hora previstas del traslado">
            <input name="transferAt" type="datetime-local" required />
          </Field>
          <p className="hint">
            Enviar esta solicitud no emite la guía en SUNAT ni descuenta stock.
            Confirma la salida cuando el traslado ocurra y la guía esté
            aceptada.
          </p>
        </WarehouseForm>
      )}
      <QueryState {...query}>
        {!query.data?.items.length && (
          <p className="hint">No hay solicitudes en esta vista.</p>
        )}
        {!!query.data?.items.length && (
          <ul className="warehouse-list supply-list">
            {query.data?.items.map((row) => {
              const offered = actions(row, user);
              if (
                report &&
                row.pending &&
                ["receive", "request_return"].includes(row.pending.action)
              )
                offered.push(row.pending.action);
              if (report && !row.pending) {
                if (row.received < row.delivered) offered.push("receive");
                if (row.received - row.returned - row.returnRequested > 0)
                  offered.push("request_return");
              }
              return (
                <li key={row.id}>
                  <div className="supply-summary">
                    <div className="supply-title">
                      <strong>
                        <Package size={16} aria-hidden="true" /> {row.sku} ·{" "}
                        {row.materialName}
                      </strong>
                      <span className="ops-stock-status">
                        {row.cancelled
                          ? "Cancelada"
                          : row.returnRequested > 0
                            ? "Devolución por recibir"
                            : row.reserved > 0
                              ? "Material reservado"
                              : row.quantity > row.delivered
                                ? "Por preparar"
                                : row.delivered > row.received
                                  ? "En camino a obra"
                                  : "Entregada a obra"}
                      </span>
                    </div>
                    {!workId &&
                      (user.permissions.includes("works") &&
                      user.permissions.some(
                        (p) => p === "works_all" || p === "works_manage",
                      ) ? (
                        <a href={`#works/${row.workId}`}>{row.workName}</a>
                      ) : (
                        <span>{row.workName}</span>
                      ))}
                    <small>
                      Necesario el {row.neededBy.split("-").reverse().join("/")}{" "}
                      · {unitName(row.unit)}
                    </small>
                    <p>{row.reason}</p>
                    <div className="supply-next-summary">
                      <div>
                        <span>
                          {row.cancelled
                            ? "Pendiente cancelado"
                            : "Por entregar a la obra"}
                        </span>
                        <strong>
                          {amount(Math.max(0, row.quantity - row.delivered))}{" "}
                          <small>{unitName(row.unit)}</small>
                        </strong>
                        <small>
                          De {amount(row.quantity)} {unitName(row.unit)}{" "}
                          solicitados · {amount(row.delivered)} entregados
                        </small>
                      </div>
                      <p>
                        {row.cancelled
                          ? "Revisa el historial para consultar los movimientos realizados."
                          : row.pending
                            ? "Hay un movimiento por terminar. Continúa la operación pendiente."
                            : row.returnRequested > 0
                              ? "La obra solicita devolver material. Confirma lo que llegue al almacén."
                              : row.reserved > 0
                                ? "Ya hay material separado. La salida requiere una guía aceptada."
                                : row.quantity > row.delivered
                                  ? "Separa existencias con Reservar. Si no alcanzan, solicita la compra del faltante."
                                  : row.received < row.delivered
                                    ? "El material salió del almacén. La obra debe confirmar su recepción."
                                    : "La obra confirmó lo recibido."}
                      </p>
                    </div>
                    <details className="supply-tracking">
                      <summary>
                        Ver seguimiento de cantidades <ChevronDown size={15} />
                      </summary>
                      <dl className="supply-quantities">
                        {[
                          ["Solicitado", row.quantity],
                          ["Reservado", row.reserved],
                          ["Entregado", row.delivered],
                          ["Recibido", row.received],
                          ["Devuelto", row.returned],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt>{label}</dt>
                            <dd>
                              {amount(Number(value))}{" "}
                              <small>{unitName(row.unit)}</small>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    {!workId && (
                      <p className="hint">
                        Disponible en Almacén · {amount(row.available || 0)}{" "}
                        {unitName(row.unit)}
                      </p>
                    )}
                    {row.returnRequested > 0 && (
                      <p className="hint">
                        Devolución por recibir · {amount(row.returnRequested)}
                      </p>
                    )}
                    {row.purchaseId &&
                      user.permissions.includes("inventory") && (
                        <a href={`#inventory/compras/${row.purchaseId}`}>
                          Revisar pedido del faltante
                        </a>
                      )}
                    {row.cancelled && (
                      <p className="hint">
                        {row.delivered
                          ? "Faltante cancelado"
                          : "Solicitud cancelada"}
                      </p>
                    )}
                    {row.pending && (
                      <p className="hint">
                        Hay una operación pendiente. Reinténtala para confirmar
                        el movimiento.
                      </p>
                    )}
                    {row.guideRequest && (
                      <p className="hint">
                        <Truck size={15} aria-hidden="true" /> Guía de remisión
                        ·{" "}
                        {row.guideRequest.number ||
                          DISPATCH_STATUS[row.guideRequest.status]}
                        {["review", "draft", "returned", "rejected"].includes(
                          row.guideRequest.status,
                        )
                          ? " · Contabilidad debe completar o revisar el traslado."
                          : ""}
                      </p>
                    )}
                    <div className="supply-actions">
                      {!workId &&
                        !row.cancelled &&
                        !row.pending &&
                        row.reserved > 0 &&
                        !row.guideRequest &&
                        user.permissions.includes("inventory_dispatch") && (
                          <Button onClick={() => setGuide(row)}>
                            <Truck size={15} />
                            Solicitar guía de remisión
                          </Button>
                        )}
                      {offered
                        .sort(
                          (a, b) =>
                            Number(a === "cancel") - Number(b === "cancel"),
                        )
                        .map((action) => (
                          <Button
                            variant={
                              (action === "reserve" && row.reserved === 0) ||
                              action === "receive" ||
                              (action === "deliver" &&
                                !!row.guideRequest &&
                                ["accepted", "observed"].includes(
                                  row.guideRequest.status,
                                ))
                                ? "primary"
                                : "ghost"
                            }
                            disabled={
                              action === "deliver" &&
                              !!row.guideRequest &&
                              !["accepted", "observed"].includes(
                                row.guideRequest.status,
                              )
                            }
                            key={action}
                            onClick={() => setSelected({ row, action })}
                          >
                            {row.pending
                              ? "Reintentar " +
                                supplyActionLabels[action].toLowerCase()
                              : supplyActionLabels[action]}
                          </Button>
                        ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      {(page > 1 || query.data?.hasMore) && (
        <div className="accounting-tools">
          <Button
            variant="ghost"
            disabled={page === 1 || query.loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Anterior
          </Button>
          <span className="hint">Página {page}</span>
          <Button
            variant="ghost"
            disabled={!query.data?.hasMore || query.loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
      {create && workId && (
        <CreateRequest
          path={path}
          close={() => setCreate(false)}
          done={() => {
            setCreate(false);
            query.refresh();
          }}
        />
      )}
      {selected && (
        <RequestAction
          row={selected.row}
          action={selected.action}
          workId={workId}
          close={() => {
            setSelected(undefined);
            query.refresh();
          }}
          done={() => {
            setSelected(undefined);
            query.refresh();
          }}
        />
      )}
    </section>
  );
}
function CreateRequest({
  path,
  close,
  done,
}: {
  path: string;
  close: () => void;
  done: () => void;
}) {
  const materials = useAccountingQuery<MaterialOption[]>(path + "/materials");
  const id = useRef(recordId());
  const [materialId, setMaterial] = useState("");
  return (
    <WarehouseForm
      title="Solicitar material"
      action="Enviar a Almacén"
      onClose={close}
      canSubmit={!!materialId}
      save={async (form) => {
        await api(path, {
          method: "POST",
          body: JSON.stringify({
            id: id.current,
            materialId,
            quantity: Number(form.get("quantity")),
            neededBy: stringField(form, "neededBy"),
            reason: stringField(form, "reason"),
          }),
        });
        done();
      }}
    >
      <QueryState {...materials}>
        <Field label="Material">
          <Select
            floating
            label="Material"
            value={materialId}
            options={(materials.data || []).map((row) => ({
              value: row.id,
              label: row.sku + " · " + row.name + " · " + unitName(row.unit),
            }))}
            onChange={setMaterial}
          />
        </Field>
      </QueryState>
      <Field label="Cantidad">
        <input
          name="quantity"
          type="number"
          required
          min="0.001"
          step="0.001"
        />
      </Field>
      <Field label="Fecha necesaria">
        <input name="neededBy" type="date" required />
      </Field>
      <Field label="Para qué se necesita">
        <textarea
          name="reason"
          rows={3}
          required
          minLength={5}
          maxLength={500}
        />
      </Field>
    </WarehouseForm>
  );
}
function RequestAction({
  row,
  action,
  workId,
  close,
  done,
}: {
  row: SupplyRequest;
  action: SupplyAction["action"];
  workId?: string;
  close: () => void;
  done: () => void;
}) {
  const id = useRef(row.pending?.operationId || crypto.randomUUID());
  const [guideId, setGuide] = useState(row.pending?.guideId || "");
  const guides = useAccountingQuery<
    {
      id: string;
      number: string;
      quantity: number;
      items: { name: string; quantity: number }[];
    }[]
  >(action === "deliver" ? `/admin/supply-requests/${row.id}/guides` : "");
  const pending = row.pending;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const warehouse = !["receive", "request_return"].includes(action);
  const path = warehouse
    ? `/admin/supply-requests/${row.id}/actions`
    : `/admin/works/${workId}/supplies/${row.id}/actions`;
  const quantity =
    action === "reserve"
      ? row.reserved
      : action === "receive"
        ? row.delivered - row.received
        : action === "accept_return"
          ? row.returnRequested
          : action === "request_return"
            ? row.received - row.returned - row.returnRequested
            : row.reserved;
  return (
    <WarehouseForm
      title={supplyActionLabels[action]}
      action="Confirmar"
      onClose={close}
      canSubmit={
        !cancelling && (action !== "deliver" || !!guideId || !!pending)
      }
      save={async (form) => {
        const selected = guides.data?.find((guide) => guide.id === guideId);
        const body: SupplyAction = pending
          ? {
              operationId: pending.operationId,
              version: row.version,
              action: pending.action,
              quantity: pending.quantity,
              guideId: pending.guideId,
              note: pending.note,
            }
          : {
              operationId: id.current,
              version: row.version,
              action,
              quantity:
                action === "deliver"
                  ? selected?.quantity || 0
                  : ["cancel", "purchase"].includes(action)
                    ? 0
                    : Number(form.get("quantity")),
              ...(guideId ? { guideId } : {}),
              note: stringField(form, "note"),
            };
        await api(path, { method: "POST", body: JSON.stringify(body) });
        done();
      }}
    >
      <p className="hint">
        {row.materialName} · {row.workName}
      </p>
      {pending?.action === "deliver" && (
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              setCancelError("");
              try {
                await api(`/admin/supply-requests/${row.id}/cancel-delivery`, {
                  method: "POST",
                  body: JSON.stringify({ version: row.version }),
                });
                done();
              } catch (e) {
                setCancelError((e as Error).message);
              } finally {
                setCancelling(false);
              }
            }}
          >
            Cancelar preparación sin salida
          </Button>
          {cancelError && <Notice error>{cancelError}</Notice>}
        </>
      )}
      {action === "cancel" && (
        <p className="hint">
          Se liberará la reserva pendiente. Las entregas y pedidos registrados
          conservan su seguimiento.
        </p>
      )}
      {action === "deliver" &&
        guideId &&
        guides.data?.find((guide) => guide.id === guideId) && (
          <div className="warehouse-preview">
            <strong>Contenido completo de la guía</strong>
            <p className="hint">
              Se entregarán todos sus materiales con las reservas de esta obra.
            </p>
            <ul>
              {guides.data
                .find((guide) => guide.id === guideId)!
                .items.map((item, index) => (
                  <li key={index}>
                    {item.name} · {amount(item.quantity)}
                  </li>
                ))}
            </ul>
          </div>
        )}
      {action === "deliver" && !pending && (
        <QueryState {...guides}>
          <Field label="Guía aceptada">
            <Select
              floating
              label="Guía aceptada"
              value={guideId}
              onChange={setGuide}
              options={(guides.data || [])
                .filter((guide) => guide.quantity <= row.reserved)
                .map((guide) => ({
                  value: guide.id,
                  label:
                    guide.number +
                    " · " +
                    amount(guide.quantity) +
                    " " +
                    row.unit,
                }))}
            />
          </Field>
          {!guides.data?.some((guide) => guide.quantity <= row.reserved) && (
            <p className="hint">
              Prepara una guía para esta obra con este material y una cantidad
              cubierta por la reserva.
            </p>
          )}
        </QueryState>
      )}
      {!["deliver", "cancel", "purchase"].includes(action) && (
        <Field
          label={
            action === "reserve" ? "Cantidad total a reservar" : "Cantidad"
          }
        >
          <input
            name="quantity"
            type="number"
            min={action === "reserve" ? 0 : 0.001}
            step="0.001"
            required
            defaultValue={pending?.quantity ?? quantity}
            disabled={!!pending}
          />
        </Field>
      )}
      {!pending && (
        <Field label="Observación">
          <textarea name="note" rows={3} maxLength={500} />
        </Field>
      )}
    </WarehouseForm>
  );
}
