import { useRef, useState } from "react";
import { Plus, Package } from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import {
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
import { WarehouseForm, stringField } from "./shared";
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
        <a className="warehouse-link" href="#inventory/solicitudes">
          Ver todas las solicitudes
        </a>
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
      <QueryState {...query}>
        {!query.data?.items.length && (
          <p className="hint">No hay solicitudes en esta vista.</p>
        )}
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
                  <strong>
                    <Package size={16} aria-hidden="true" /> {row.sku} ·{" "}
                    {row.materialName}
                  </strong>
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
                    Necesario el {row.neededBy.split("-").reverse().join("/")} ·{" "}
                    {unitName(row.unit)}
                  </small>
                  <p>{row.reason}</p>
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
                        <dd>{amount(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
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
                  {row.purchaseId && user.permissions.includes("inventory") && (
                    <a href={`#inventory/compras/${row.purchaseId}`}>
                      Revisar compra del faltante
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
                      Hay una operación pendiente. Reinténtala para confirmar el
                      movimiento.
                    </p>
                  )}
                  <div className="supply-actions">
                    {offered.map((action) => (
                      <Button
                        variant="ghost"
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
          Se liberará la reserva pendiente. Las entregas y compras registradas
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
