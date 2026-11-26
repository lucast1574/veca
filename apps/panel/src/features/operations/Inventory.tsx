import { WarehouseBack } from "../warehouse/shared";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { Modal } from "../../components/Modal";
import {
  EditMaterialDimensions,
  MaterialForm,
} from "../warehouse/MaterialForm";
import { useAccountingQuery } from "../accounting/accounting-shared";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import {
  MATERIAL_CATEGORIES,
  formatMaterialDimensions,
  type Material,
  type Movement,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import {
  Plus,
  Package,
  PackagePlus,
  Search,
  RefreshCw,
  History,
  ClipboardCheck,
} from "lucide-react";
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
  initialQuantity,
  canReturn = false,
}: {
  materials: Material[];
  leadId: string | null;
  onSaved: (movement: Movement) => void;
  initialMaterial?: string;
  initialQuantity?: number;
  canReturn?: boolean;
  onCancel: () => void;
}) {
  const [material, setMaterial] = useState(initialMaterial),
    [kind, setKind] = useState(leadId ? "consumption" : "receipt"),
    [busy, setBusy] = useState(false);
  const [quantity, setQuantity] = useState(initialQuantity?.toString() ?? "");
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
                  if (initialQuantity !== undefined && value !== material)
                    setQuantity("");
                  setDirty(true);
                }}
                options={materials.map((m) => ({
                  value: m.id,
                  label: m.name,
                  description: [
                    m.sku,
                    m.dimensions && formatMaterialDimensions(m.dimensions),
                    `Disponible: ${amount(m.available ?? m.balance)} ${unitName(m.unit)}`,
                  ]
                    .filter(Boolean)
                    .join(" · "),
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
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
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
            {selected && (
              <>
                Disponible: {amount(selected.available ?? selected.balance)}{" "}
                {unitName(selected.unit)}.{" "}
              </>
            )}
            {leadId
              ? "El movimiento queda en el historial. Cerrar la obra no vuelve a descontarlo."
              : "La entrada quedará registrada en el historial."}
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
  const [editingDimensions, setEditingDimensions] = useState<Material>();
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("");
  const [create, setCreate] = useState(false);
  const [movement, setMovement] = useState<{
    materialId: string;
    quantity?: number;
  }>();
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
  const filtered = items.filter(
    (m) =>
      `${m.name} ${m.sku} ${m.category} ${m.location} ${m.dimensions ? formatMaterialDimensions(m.dimensions) : ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!category || m.category === category) &&
      (!stock ||
        (stock === "empty"
          ? (m.available ?? m.balance) === 0
          : (m.available ?? m.balance) <= m.minimum)),
  );
  const rows = filtered.map((material) => {
    const available = material.available ?? material.balance;
    const shortage = Math.round((material.minimum - available) * 1000) / 1000;
    return {
      ...material,
      available,
      needsRestock: available <= material.minimum,
      suggestedQuantity: shortage > 0 ? shortage : undefined,
    };
  });
  return (
    <main className="ops-page">
      <div className="ops-heading">
        <div>
          {materialId && (
            <WarehouseBack href="#inventory/materiales">
              Volver a materiales
            </WarehouseBack>
          )}
          <h2>{selected.data?.name || "Materiales"}</h2>
        </div>
        <div className="ops-heading-actions">
          {!materialId && canCatalog && (
            <ImportCatalogButton onClick={() => setImporting(true)} />
          )}
          {!materialId && canCatalog && (
            <Button variant="ghost" onClick={() => setCreate(true)}>
              <Plus size={16} /> Nuevo material
            </Button>
          )}
          <Button
            disabled={
              !canReceive || (materialId ? !selected.data : !items.length)
            }
            onClick={() => setMovement({ materialId: materialId || "" })}
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
      {editingDimensions && (
        <EditMaterialDimensions
          material={editingDimensions}
          close={() => setEditingDimensions(undefined)}
          done={() => {
            setEditingDimensions(undefined);
            setMessage("Medidas actualizadas.");
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
      {movement && (
        <MaterialMovement
          materials={
            selected.data &&
            !items.some((item) => item.id === selected.data?.id)
              ? [selected.data, ...items]
              : items
          }
          leadId={null}
          initialMaterial={movement.materialId}
          initialQuantity={movement.quantity}
          onCancel={() => setMovement(undefined)}
          onSaved={(entry) => {
            setMovement(undefined);
            setMessage(
              `Entrada registrada para ${entry.materialName}: ${amount(entry.quantity)} ${unitName(entry.unit)}. Saldo: ${amount(entry.balanceAfter)} ${unitName(entry.unit)}.`,
            );
            refresh();
          }}
        />
      )}
      {!materialId && (
        <div className="ops-toolbar material-filters">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="Buscar materiales"
              placeholder="Nombre, código, familia o ubicación…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Select
            label="Familia de material"
            value={category}
            onChange={setCategory}
            options={[
              { value: "", label: "Todas las familias" },
              ...MATERIAL_CATEGORIES.map((c) => ({ value: c, label: c })),
            ]}
          />
          <Select
            label="Existencias"
            value={stock}
            onChange={setStock}
            options={[
              { value: "", label: "Todas las existencias" },
              { value: "low", label: "Por reponer" },
              { value: "empty", label: "Sin existencias" },
            ]}
          />
          <button
            type="button"
            className="accounting-refresh"
            aria-label="Actualizar inventario"
            onClick={refresh}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      )}
      {selected.data && (
        <section
          className="ops-card material-detail"
          aria-label="Existencias del material"
        >
          <p>
            {[
              selected.data.sku,
              selected.data.category,
              selected.data.location || "Sin ubicación",
              selected.data.dimensions &&
                formatMaterialDimensions(selected.data.dimensions),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <dl className="material-stock">
            {(
              [
                [
                  "Disponible para usar",
                  selected.data.available ?? selected.data.balance,
                ],
                ["En almacén", selected.data.balance],
                ["Reservado", selected.data.reserved || 0],
                ["Stock mínimo", selected.data.minimum],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {amount(value)}{" "}
                  <small>{unitName(selected.data?.unit || "")}</small>
                </dd>
              </div>
            ))}
          </dl>
          <div className="material-actions">
            {canAdjust && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCount(selected.data)}
              >
                <ClipboardCheck size={16} /> Hacer conteo físico
              </Button>
            )}
            {canCatalog && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingDimensions(selected.data)}
              >
                Editar medidas
              </Button>
            )}
          </div>
        </section>
      )}
      {!materialId && catalog.data && (
        <div className="ops-table-wrap material-catalog">
          <table className="ops-material-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Material</th>
                <th role="columnheader">Familia</th>
                <th role="columnheader">Ubicación</th>
                <th role="columnheader">Disponible</th>
                <th role="columnheader">Mínimo</th>
                <th role="columnheader">Estado</th>
                {(canAdjust || canReceive) && (
                  <th role="columnheader">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((m) => (
                <tr key={m.id} role="row">
                  <td role="cell">
                    <strong className="material-catalog-name">{m.name}</strong>
                    <small>
                      {[
                        m.sku,
                        m.dimensions && formatMaterialDimensions(m.dimensions),
                        m.description,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <a
                      className="warehouse-link material-catalog-history"
                      aria-label={`Ver historial de ${m.name}`}
                      href={`#inventory/materiales/${m.id}`}
                    >
                      <History size={15} aria-hidden="true" /> Ver historial
                    </a>
                  </td>
                  <td role="cell" data-label="Familia">
                    {m.category}
                  </td>
                  <td role="cell" data-label="Ubicación">
                    {m.location || "Sin ubicación"}
                  </td>
                  <td role="cell" data-label="Disponible">
                    <strong>{amount(m.available)}</strong> {unitName(m.unit)}
                    <small>
                      En almacén {amount(m.balance)} {unitName(m.unit)} ·
                      Reservado {amount(m.reserved || 0)} {unitName(m.unit)}
                    </small>
                  </td>
                  <td role="cell" data-label="Mínimo">
                    {amount(m.minimum)} {unitName(m.unit)}
                  </td>
                  <td role="cell">
                    <span
                      className={`ops-stock-status ${m.needsRestock ? "low" : ""}`}
                    >
                      {m.available === 0
                        ? "Sin stock"
                        : m.needsRestock
                          ? "Por reponer"
                          : "Disponible"}
                    </span>
                  </td>
                  {(canAdjust || canReceive) && (
                    <td role="cell" className="material-catalog-action-cell">
                      <div className="material-catalog-actions">
                        {canReceive && (
                          <Button
                            type="button"
                            data-action="entry"
                            variant={m.needsRestock ? "primary" : "ghost"}
                            aria-label={
                              m.needsRestock
                                ? `Reponer ${m.name}`
                                : `Registrar entrada de ${m.name}`
                            }
                            onClick={() =>
                              setMovement({
                                materialId: m.id,
                                quantity: m.suggestedQuantity,
                              })
                            }
                          >
                            <PackagePlus size={16} aria-hidden="true" />
                            {m.needsRestock ? "Reponer" : "Registrar entrada"}
                          </Button>
                        )}
                        {canAdjust && (
                          <Button
                            type="button"
                            data-action="count"
                            variant="ghost"
                            onClick={() => setCount(m)}
                            aria-label={`Hacer conteo físico de ${m.name}`}
                          >
                            <ClipboardCheck size={16} aria-hidden="true" />{" "}
                            Contar
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
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
      <section className="ops-card material-history">
        <div className="ops-card-heading">
          <h2>{materialId ? "Historial de stock" : "Últimos movimientos"}</h2>
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
        {history.data &&
          (history.data.length || !materialId ? (
            <Movements items={history.data} />
          ) : (
            <div className="material-history-empty">
              <History size={22} aria-hidden="true" />
              <div>
                <strong>
                  Este material aún no tiene movimientos registrados
                </strong>
                <p>
                  Las entradas, salidas y conteos aparecerán aquí con su fecha y
                  saldo.
                </p>
              </div>
            </div>
          ))}
      </section>
    </main>
  );
}
