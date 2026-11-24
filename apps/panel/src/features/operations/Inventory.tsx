import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { Modal } from "../../components/Modal";
import { MaterialForm } from "../warehouse/MaterialForm";
import { useAccountingQuery } from "../accounting/accounting-shared";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { type Material, type Movement } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Plus, Package, Search, RefreshCw } from "lucide-react";
import { post } from "../../lib/api";
import {
  CatalogImport,
  CountStock,
  ImportCatalogButton,
} from "../warehouse/CatalogActions";
import { Field, Button, Notice } from "../../components/ui";
import {
  amount,
  unitName,
  Movements,
  useLiveRefresh,
  useMessage,
} from "./shared";
export function MaterialMovement({
  materials,
  leadId,
  onSaved,
  onCancel,
  initialMaterial = "",
  canReturn = false,
}: {
  materials: Material[];
  leadId: string | null;
  onSaved: (movement: Movement) => void;
  initialMaterial?: string;
  canReturn?: boolean;
  onCancel: () => void;
}) {
  const [material, setMaterial] = useState(initialMaterial),
    [kind, setKind] = useState(leadId ? "consumption" : "receipt"),
    [busy, setBusy] = useState(false);
  const operation = useRef(crypto.randomUUID());
  const [dirty, setDirty] = useState(false);
  const clearGuard = useUnsavedChanges(dirty, busy);
  const formId = useId();
  const close = () => {
    if (confirmDiscard(dirty, busy)) onCancel();
  };
  const { error, setError, fail } = useMessage();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !material) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const movement = await post<Movement>(
        `/admin/crm/materials/${material}/movements`,
        {
          operationId: operation.current,
          kind,
          quantity: Number(form.get("quantity")),
          reason: form.get("reason"),
          leadId,
        },
      );
      clearGuard();
      onSaved(movement);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const selected = materials.find((m) => m.id === material);
  return (
    <Modal
      title={
        leadId ? "Registrar materiales de la obra" : "Registrar una entrada"
      }
      onClose={close}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={busy || !material}>
            {busy ? "Registrando…" : "Registrar movimiento"}
          </Button>
        </footer>
      }
    >
      <form
        id={formId}
        className="ops-movement-form"
        onSubmit={save}
        onChange={() => setDirty(true)}
      >
        <fieldset className="warehouse-fields" disabled={busy}>
          {error && <Notice error>{error}</Notice>}
          <div className="ops-form-grid">
            <Field label="Material">
              <Select
                floating
                label="Material"
                value={material}
                placeholder="Selecciona un material"
                onChange={(value) => {
                  setMaterial(value);
                  setDirty(true);
                }}
                options={materials.map((m) => ({
                  value: m.id,
                  label: m.name,
                  description: `${m.sku} · Disponible: ${amount(m.available ?? m.balance)} ${unitName(m.unit)}`,
                }))}
              />
            </Field>
            {leadId && (
              <Field label="Movimiento">
                <Select
                  floating
                  label="Movimiento"
                  value={kind}
                  onChange={(value) => {
                    setKind(value);
                    setDirty(true);
                  }}
                  options={[
                    {
                      value: "consumption",
                      label: "Consumo en obra",
                      description: "Descontar del inventario",
                    },
                    ...(canReturn
                      ? [
                          {
                            value: "return",
                            label: "Devolución de obra",
                            description: "Reintegrar material al inventario",
                          },
                        ]
                      : []),
                  ]}
                />
              </Field>
            )}
            <Field label={`Cantidad (${unitName(selected?.unit || "")})`}>
              <input
                name="quantity"
                type="number"
                required
                min="0.001"
                step="0.001"
                max="1000000"
              />
            </Field>
            <Field label="Detalle o motivo">
              <input
                name="reason"
                required
                minLength={4}
                maxLength={1000}
                placeholder={
                  leadId
                    ? "Ej. Ventanas del segundo piso"
                    : "Ej. Recepción según guía del proveedor"
                }
              />
            </Field>
          </div>
          <p className="hint">
            Disponible: {amount(selected?.balance || 0)}{" "}
            {unitName(selected?.unit || "")}. El movimiento queda en el
            historial; cerrar la obra no vuelve a descontarlo.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}
export function Inventory({
  materialId,
  canCatalog = false,
  canAdjust = false,
  canReceive = false,
}: {
  materialId?: string;
  canCatalog?: boolean;
  canAdjust?: boolean;
  canReceive?: boolean;
}) {
  const [importing, setImporting] = useState(false);
  const [count, setCount] = useState<Material>();
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [create, setCreate] = useState(false);
  const [movement, setMovement] = useState<string | null>(null);
  const catalog = useAccountingQuery<Material[]>("/admin/crm/materials");
  const selected = useAccountingQuery<Material>(
    materialId ? `/admin/crm/materials/${encodeURIComponent(materialId)}` : "",
  );
  const history = useAccountingQuery<Movement[]>(
    `/admin/crm/movements${materialId ? `?materialId=${encodeURIComponent(materialId)}` : ""}`,
  );
  const { refresh: reloadCatalog } = catalog;
  const { refresh: reloadSelected } = selected;
  const { refresh: reloadHistory } = history;
  const refresh = useCallback(() => {
    reloadCatalog();
    reloadSelected();
    reloadHistory();
  }, [reloadCatalog, reloadSelected, reloadHistory]);
  const items = catalog.data || [];
  useLiveRefresh(refresh, false);
  const filtered = (
    materialId ? (selected.data ? [selected.data] : []) : items
  ).filter((m) =>
    `${m.name} ${m.sku} ${m.category}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className="ops-page">
      <div className="ops-heading">
        <div>
          {materialId && (
            <a className="warehouse-link" href="#inventory/materiales">
              Volver a materiales
            </a>
          )}
          <h2>{selected.data?.name || "Materiales"}</h2>
        </div>
        <div className="ops-heading-actions">
          {canCatalog && (
            <ImportCatalogButton onClick={() => setImporting(true)} />
          )}
          <Button
            variant="ghost"
            disabled={!canCatalog}
            onClick={() => setCreate(true)}
          >
            <Plus size={16} />
            Nuevo material
          </Button>
          <Button
            disabled={!items.length && !selected.data}
            onClick={() => setMovement(materialId || "")}
          >
            <Package size={17} />
            Registrar entrada
          </Button>
        </div>
      </div>
      {catalog.data && !materialId && (
        <div className="ops-summary">
          <div>
            <span>Materiales</span>
            <strong>{items.length}</strong>
          </div>
          <div>
            <span>Por reponer</span>
            <strong>
              {
                items.filter((m) => (m.available ?? m.balance) <= m.minimum)
                  .length
              }
            </strong>
          </div>
          <div>
            <span>Sin existencias</span>
            <strong>
              {items.filter((m) => (m.available ?? m.balance) === 0).length}
            </strong>
          </div>
        </div>
      )}
      {(materialId
        ? selected.loading && !selected.data
        : catalog.loading && !catalog.data) && (
        <p role="status">Cargando materiales…</p>
      )}
      {(materialId ? selected.error : catalog.error) && (
        <Notice error>
          {materialId ? selected.error : catalog.error}{" "}
          <button
            type="button"
            onClick={materialId ? reloadSelected : reloadCatalog}
          >
            Reintentar
          </button>
        </Notice>
      )}
      {message && (
        <p className="warehouse-message" role="status">
          {message}
        </p>
      )}
      {importing && (
        <CatalogImport
          close={() => setImporting(false)}
          done={(message) => {
            setMessage(message);
            setImporting(false);
            refresh();
          }}
        />
      )}
      {count && (
        <CountStock
          material={count}
          close={() => setCount(undefined)}
          done={() => {
            setCount(undefined);
            setMessage("Conteo guardado.");
            refresh();
          }}
        />
      )}
      {create && (
        <MaterialForm
          close={() => setCreate(false)}
          done={() => {
            setCreate(false);
            setMessage("Material registrado.");
            refresh();
          }}
        />
      )}
      {movement !== null && (
        <MaterialMovement
          key={movement}
          materials={
            selected.data &&
            !items.some((item) => item.id === selected.data?.id)
              ? [selected.data, ...items]
              : items
          }
          leadId={null}
          initialMaterial={movement}
          onCancel={() => setMovement(null)}
          onSaved={(entry) => {
            setMovement(null);
            setMessage(
              `Entrada registrada para ${entry.materialName}: ${amount(entry.quantity)} ${unitName(entry.unit)}. Saldo: ${amount(entry.balanceAfter)} ${unitName(entry.unit)}.`,
            );
            refresh();
          }}
        />
      )}
      {!materialId && (
        <div className="ops-toolbar">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="Buscar materiales"
              placeholder="Nombre, código o familia…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            className="ops-icon-button"
            aria-label="Actualizar inventario"
            onClick={refresh}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      )}
      {(materialId ? selected.data : catalog.data) && (
        <div className="ops-table-wrap">
          <table className="ops-material-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Familia</th>
                <th>Ubicación</th>
                <th>Disponible</th>
                <th>Mínimo</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id}>
                  <td>
                    <a
                      className="warehouse-link"
                      href={`#inventory/materiales/${m.id}`}
                    >
                      <strong>{m.name}</strong>
                    </a>
                    <small>
                      {m.sku} · {m.description}
                    </small>
                  </td>
                  <td>{m.category}</td>
                  <td>{m.location || "Sin ubicación"}</td>
                  <td>
                    <strong>{amount(m.available ?? m.balance)}</strong>{" "}
                    {unitName(m.unit)}
                    <small>
                      En almacén {amount(m.balance)} · Reservado{" "}
                      {amount(m.reserved || 0)}
                    </small>
                  </td>
                  <td>{amount(m.minimum)}</td>
                  <td>
                    <span
                      className={`ops-stock-status ${(m.available ?? m.balance) <= m.minimum ? "low" : ""}`}
                    >
                      {(m.available ?? m.balance) === 0
                        ? "Sin stock"
                        : (m.available ?? m.balance) <= m.minimum
                          ? "Reponer"
                          : "Disponible"}
                    </span>
                  </td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canAdjust}
                      onClick={() => setCount(m)}
                      aria-label={`Contar ${m.name}`}
                    >
                      Contar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Registrar entrada de ${m.name}`}
                      disabled={!canReceive}
                      onClick={() => setMovement(m.id)}
                    >
                      Entrada
                    </Button>
                    {!materialId && (
                      <a
                        className="warehouse-link"
                        href={`#inventory/materiales/${m.id}`}
                      >
                        Historial
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="ops-empty">
              <Package size={32} />
              <h2>
                {items.length
                  ? "No hay coincidencias"
                  : "El almacén empieza con tu primer material"}
              </h2>
              <p>
                {items.length
                  ? "Prueba otro nombre, código o familia."
                  : "Registra vidrios, perfiles, herrajes y consumibles con sus unidades reales."}
              </p>
            </div>
          )}
        </div>
      )}
      <section className="ops-card">
        <div className="ops-card-heading">
          <h2>Últimos movimientos</h2>
          <span>Hasta 100 registros recientes</span>
        </div>
        {history.loading && !history.data && (
          <p role="status">Cargando movimientos…</p>
        )}
        {history.error && (
          <Notice error>
            {history.error}{" "}
            <button type="button" onClick={reloadHistory}>
              Reintentar
            </button>
          </Notice>
        )}
        {history.data && <Movements items={history.data} />}
      </section>
    </main>
  );
}
