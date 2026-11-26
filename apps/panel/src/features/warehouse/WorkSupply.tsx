import { useState } from "react";
import {
  ClipboardList,
  Plus,
  ShoppingCart,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  workPlanInput,
  type Equipment,
  type WorkSupply as Supply,
} from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import {
  amount as money,
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { amount, unitName, useLiveRefresh } from "../operations/shared";
import {
  materialOptions,
  purchaseStatus,
  putWarehouse,
  useWarehouseMaterials,
  warehousePath,
  WarehouseForm,
  WarehouseSelect,
} from "./shared";

export function WorkSupply({
  id,
  canManage = false,
  canRequest = false,
}: {
  id: string;
  canManage?: boolean;
  canRequest?: boolean;
}) {
  const path = warehousePath + "/works/" + id;
  const query = useAccountingQuery<Supply>(path);
  useLiveRefresh(query.refresh);
  const [editing, setEditing] = useState(false);
  const row = query.data;
  return (
    <section className="ops-card warehouse-panel">
      <div className="accounting-section-head">
        <div>
          <h2>Materiales y equipos previstos</h2>
          {Boolean(row?.plan.budgetCents) && (
            <p className="hint">
              Presupuesto de costos {money(row!.plan.budgetCents)}
            </p>
          )}
        </div>
        <div className="accounting-tools work-supply-actions">
          {row && canManage && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(true)}
            >
              Editar plan
            </Button>
          )}
          {row && canRequest && (
            <a
              className="btn btn-primary"
              href={`#inventory/compras/nueva/${id}`}
            >
              <ShoppingCart size={16} aria-hidden="true" /> Solicitar compra
            </a>
          )}
        </div>
      </div>
      <QueryState {...query}>
        {row && (
          <>
            {!row.materials.length && !row.equipment.length && (
              <p className="hint">
                Añade materiales y equipos para preparar esta obra.
              </p>
            )}
            {Boolean(row.materials.length) && (
              <div className="ops-table-wrap">
                <table className="ops-material-table warehouse-plan-table">
                  <thead>
                    <tr>
                      {[
                        "Material",
                        "Previsto",
                        "Solicitado",
                        "Pedido",
                        "Recibido",
                        "Entregado",
                        "Usado",
                        "Devuelto",
                      ].map((item) => (
                        <th key={item}>{item}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {row.materials.map((item) => (
                      <tr key={item.materialId}>
                        <td>
                          <strong>
                            {item.sku} · {item.name}
                          </strong>
                          <small>{unitName(item.unit)}</small>
                        </td>
                        {[
                          item.planned,
                          item.requested,
                          item.ordered,
                          item.received,
                          item.delivered,
                          item.consumed,
                          item.returned,
                        ].map((value, index) => (
                          <td key={index}>{amount(value)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {Boolean(row.equipment.length || row.purchases.length) && (
              <ul className="warehouse-list">
                {row.equipment.map((equipment) => (
                  <li key={equipment.id}>
                    <Wrench size={17} aria-hidden="true" />
                    <div>
                      <a href={`#inventory/equipos/${equipment.id}`}>
                        {equipment.code} · {equipment.name}
                      </a>
                    </div>
                    <span className="ops-stock-status">
                      {equipment.assigned ? "Asignado" : "Previsto"}
                    </span>
                  </li>
                ))}
                {row.purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <ClipboardList size={17} aria-hidden="true" />
                    <div>
                      <a href={`#inventory/compras/${purchase.id}`}>
                        {purchase.supplier || "Pedido por preparar"}
                      </a>
                    </div>
                    <span className="ops-stock-status">
                      {purchaseStatus[purchase.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
      {editing && row && (
        <PlanForm
          row={row}
          path={path}
          close={() => setEditing(false)}
          done={() => {
            setEditing(false);
            query.refresh();
          }}
        />
      )}
    </section>
  );
}

function PlanForm({
  row,
  path,
  close,
  done,
}: {
  row: Supply;
  path: string;
  close: () => void;
  done: () => void;
}) {
  const [materials, setMaterials] = useState(
    row.plan.materials.map((item) => ({ ...item, key: crypto.randomUUID() })),
  );
  const [equipment, setEquipment] = useState(
    row.plan.equipment.map((id) => ({ id, key: crypto.randomUUID() })),
  );
  const catalog = useWarehouseMaterials();
  const tools = useAccountingQuery<Equipment[]>(warehousePath + "/equipment");
  const parseDraft = (form: FormData) =>
    workPlanInput.safeParse({
      revision: row.plan.revision,
      budgetCents: row.plan.budgetSource
        ? row.plan.budgetCents
        : Math.round(Number(form.get("budget")) * 100),
      materials: materials.map(({ materialId, key }) => ({
        materialId,
        quantity: Number(form.get(key)),
      })),
      equipment: equipment.map((item) => item.id),
    });
  return (
    <WarehouseForm
      title="Editar plan de obra"
      action="Guardar plan"
      wide
      onClose={close}
      validateForm={(form) => parseDraft(form).success}
      save={async (form) => {
        const parsed = parseDraft(form);
        if (!parsed.success)
          throw new Error(
            "Revisa los códigos repetidos, las cantidades y el presupuesto.",
          );
        await putWarehouse(path, parsed.data);
        done();
      }}
    >
      {(catalog.error || tools.error) && (
        <Notice error>{catalog.error || tools.error}</Notice>
      )}
      <Field
        label="Presupuesto de costos sin IGV"
        hint={
          row.plan.budgetSource
            ? `Proviene de la cotización ${row.plan.budgetSource.reference}. Se actualiza al adjuntar una nueva cotización en Resumen.`
            : undefined
        }
      >
        <input
          name="budget"
          readOnly={!!row.plan.budgetSource}
          type="number"
          min="0"
          step="0.01"
          defaultValue={row.plan.budgetCents ? row.plan.budgetCents / 100 : ""}
        />
      </Field>
      <section className="warehouse-panel">
        <h3>Materiales</h3>
        {materials.map((item, index) => (
          <div className="warehouse-edit-line" key={item.key}>
            <WarehouseSelect
              label="Código o material"
              required
              value={item.materialId}
              options={materialOptions(catalog.data || [])}
              onChange={(materialId) =>
                setMaterials((current) =>
                  current.map((line) =>
                    line.key === item.key ? { ...line, materialId } : line,
                  ),
                )
              }
            />
            <Field label="Cantidad prevista">
              <input
                name={item.key}
                type="number"
                step="0.001"
                min="0.001"
                required
                defaultValue={item.quantity || ""}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Quitar material ${index + 1}`}
              onClick={() =>
                setMaterials((current) =>
                  current.filter((line) => line.key !== item.key),
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
          disabled={materials.length >= 100}
          onClick={() =>
            setMaterials((current) => [
              ...current,
              { key: crypto.randomUUID(), materialId: "", quantity: 0 },
            ])
          }
        >
          <Plus size={16} /> Añadir material
        </Button>
      </section>
      <section className="warehouse-panel">
        <h3>Equipos</h3>
        {equipment.map((item, index) => (
          <div className="warehouse-edit-line is-tool" key={item.key}>
            <WarehouseSelect
              label="Equipo"
              required
              value={item.id}
              options={(tools.data || [])
                .filter(
                  (value) =>
                    value.condition !== "retired" ||
                    row.plan.equipment.includes(value.id),
                )
                .map((value) => ({
                  value: value.id,
                  label: `${value.code} · ${value.name}`,
                }))}
              onChange={(id) =>
                setEquipment((current) =>
                  current.map((line) =>
                    line.key === item.key ? { ...line, id } : line,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={`Quitar equipo ${index + 1}`}
              onClick={() =>
                setEquipment((current) =>
                  current.filter((line) => line.key !== item.key),
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
          disabled={equipment.length >= 100}
          onClick={() =>
            setEquipment((current) => [
              ...current,
              { key: crypto.randomUUID(), id: "" },
            ])
          }
        >
          <Plus size={16} /> Añadir equipo
        </Button>
      </section>
    </WarehouseForm>
  );
}
