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
    if (
      !row.cancelled &&
      row.delivered < row.quantity &&
      (row.available !== 0 || row.reserved > 0)
    )
      offered.push("reserve");
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

type RequestActionName = SupplyAction["action"];
type NextAction = RequestActionName | "guide";

function nextAction(
  row: SupplyRequest,
  offered: RequestActionName[],
  canRequestGuide: boolean,
): NextAction | undefined {
  if (row.pending) return offered[0];
  if (offered.includes("accept_return")) return "accept_return";
  if (offered.includes("receive")) return "receive";
  if (offered.includes("request_return")) return "request_return";
  if (offered.includes("deliver") && row.guideRequest) return "deliver";
  if (canRequestGuide) return "guide";
  if (offered.includes("reserve") && row.reserved === 0 && row.available !== 0)
    return "reserve";
  if (offered.includes("purchase") && row.available === 0) return "purchase";
}

function actionLabel(row: SupplyRequest, action: RequestActionName) {
  if (row.pending)
    return "Reintentar " + supplyActionLabels[action].toLowerCase();
  if (action === "reserve")
    return row.reserved ? "Ajustar reserva" : "Reservar material";
  if (action === "deliver" && !row.guideRequest) return "Usar guía ya emitida";
  return supplyActionLabels[action];
}

function requestStatusMessage(row: SupplyRequest, guideReady: boolean) {
  if (row.pending) return "Hay una operación pendiente.";
  if (row.returnRequested > 0) return "Almacén debe recibir la devolución.";
  if (row.guideRequest && !guideReady && row.reserved > 0) {
    return ["returned", "rejected"].includes(row.guideRequest.status)
      ? "Contabilidad debe revisar la guía."
      : "En espera de la guía de Contabilidad.";
  }
  if (row.purchaseId && row.quantity > row.delivered)
    return "Hay un pedido por el material faltante.";
  if (row.delivered > row.received) return "En espera de la recepción en obra.";
  if (row.quantity <= row.delivered) return "La obra confirmó lo recibido.";
  return "Pendiente de atención por Almacén.";
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
              const guideReady = ["accepted", "observed"].includes(
                row.guideRequest?.status ?? "",
              );
              const canRequestGuide =
                !workId &&
                !row.cancelled &&
                !row.pending &&
                row.reserved > 0 &&
                !row.guideRequest &&
                user.permissions.includes("inventory") &&
                user.permissions.includes("inventory_dispatch");
              const usable = offered.filter(
                (action) =>
                  action !== "deliver" ||
                  row.pending ||
                  !row.guideRequest ||
                  guideReady,
              );
              const primary = nextAction(row, usable, canRequestGuide);
              const canCancel =
                primary !== "cancel" && usable.includes("cancel");
              const secondary = usable.filter(
                (action) => action !== primary && action !== "cancel",
              );
              const requester =
                row.requestedByName ||
                (!/^[a-f0-9]{24}$/i.test(row.requestedBy)
                  ? row.requestedBy
                  : "");
              const unit = unitName(row.unit);
              const remaining = row.cancelled
                ? 0
                : Math.max(0, row.quantity - row.delivered);
              const inTransit = Math.max(0, row.delivered - row.received);
              const outstanding = row.returnRequested || remaining || inTransit;
              return (
                <li key={row.id}>
                  <div className="supply-summary">
                    <header className="supply-title">
                      <h3>
                        <Package size={16} aria-hidden="true" />{" "}
                        {row.materialName}
                      </h3>
                      <span
                        className={`ops-stock-status${row.cancelled ? " is-cancelled" : row.returnRequested > 0 || (!row.reserved && remaining > 0) ? " low" : ""}`}
                      >
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
                    </header>
                    <dl className="supply-meta">
                      <div>
                        <dt>Solicitado por</dt>
                        <dd>{requester || "Nombre no registrado"}</dd>
                      </div>
                      {!workId && (
                        <div>
                          <dt>Obra</dt>
                          <dd>
                            {user.permissions.includes("works") &&
                            user.permissions.some(
                              (p) => p === "works_all" || p === "works_manage",
                            ) ? (
                              <a
                                className="warehouse-link"
                                href={`#works/${row.workId}`}
                              >
                                {row.workName}
                              </a>
                            ) : (
                              row.workName
                            )}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Se necesita el</dt>
                        <dd>{row.neededBy.split("-").reverse().join("/")}</dd>
                      </div>
                    </dl>
                    {(!row.cancelled || outstanding > 0 || primary) && (
                      <div className="supply-next-summary">
                        {outstanding > 0 && (
                          <div className="supply-needed">
                            <span>
                              {row.returnRequested > 0
                                ? "Por devolver"
                                : remaining > 0
                                  ? "Por entregar"
                                  : "Por recibir en obra"}
                            </span>
                            <strong>
                              {amount(outstanding)} <small>{unit}</small>
                            </strong>
                            {row.reserved > 0 && (
                              <span>
                                Reservado{" "}
                                <b>
                                  {amount(row.reserved)} {unit}
                                </b>
                              </span>
                            )}
                          </div>
                        )}
                        <div className="supply-next-action">
                          {primary ? (
                            <Button
                              onClick={() =>
                                primary === "guide"
                                  ? setGuide(row)
                                  : setSelected({ row, action: primary })
                              }
                            >
                              {primary === "guide" ? (
                                <>
                                  <Truck size={16} /> Solicitar guía de remisión
                                </>
                              ) : (
                                actionLabel(row, primary)
                              )}
                            </Button>
                          ) : (
                            <p>{requestStatusMessage(row, guideReady)}</p>
                          )}
                          {row.available !== undefined && (
                            <p>
                              Disponible en Almacén{" "}
                              <strong>
                                {amount(row.available)} {unit}
                              </strong>
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {row.guideRequest && (
                      <p className="supply-guide">
                        <Truck size={15} aria-hidden="true" />
                        Guía de remisión ·{" "}
                        {[
                          row.guideRequest.number,
                          DISPATCH_STATUS[row.guideRequest.status],
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {row.purchaseId &&
                      user.permissions.includes("inventory") && (
                        <a
                          className="warehouse-link supply-purchase"
                          href={`#inventory/compras/${row.purchaseId}`}
                        >
                          Ver pedido del material faltante
                        </a>
                      )}
                    <details className="supply-tracking">
                      <summary>
                        {secondary.length || canCancel
                          ? "Detalles y más acciones"
                          : "Ver detalles de la solicitud"}
                        <ChevronDown size={15} aria-hidden="true" />
                      </summary>
                      <p className="supply-reason">
                        <strong>{row.sku}</strong> · {row.reason}
                      </p>
                      <dl className="supply-quantities">
                        {(
                          [
                            ["Solicitado", row.quantity],
                            ["Reservado", row.reserved],
                            ["Entregado", row.delivered],
                            ["Recibido", row.received],
                            ["Devuelto", row.returned],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>
                              {amount(value)} <small>{unit}</small>
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {(secondary.length > 0 || canCancel) && (
                        <div className="supply-actions">
                          {secondary.map((action) => (
                            <Button
                              key={action}
                              variant="ghost"
                              onClick={() => setSelected({ row, action })}
                            >
                              {actionLabel(row, action)}
                            </Button>
                          ))}
                          {canCancel && (
                            <div className="supply-cancel">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setSelected({ row, action: "cancel" })
                                }
                              >
                                Cancelar solicitud
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </details>
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
  const maximumReserve =
    row.available === undefined
      ? undefined
      : Math.round(
          Math.min(row.quantity - row.delivered, row.available + row.reserved) *
            1000,
        ) / 1000;
  const quantity =
    action === "reserve"
      ? row.reserved || maximumReserve || 0
      : action === "receive"
        ? row.delivered - row.received
        : action === "accept_return"
          ? row.returnRequested
          : action === "request_return"
            ? row.received - row.returned - row.returnRequested
            : row.reserved;
  return (
    <WarehouseForm
      title={
        action === "deliver"
          ? supplyActionLabels[action]
          : actionLabel(row, action)
      }
      action={
        action === "cancel"
          ? "Cancelar solicitud"
          : action === "reserve"
            ? "Guardar reserva"
            : "Confirmar"
      }
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
            max={action === "reserve" ? maximumReserve : undefined}
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
