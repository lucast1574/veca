import { useRef, useState } from "react";
import {
  Plus,
  Wrench,
  ChevronRight,
  MapPin,
  UserRound,
  Cog,
  Boxes,
} from "lucide-react";
import { EQUIPMENT_CATEGORIES, type Equipment } from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import {
  QueryState,
  recordId,
  Refresh,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { date } from "../operations/shared";
import {
  conditionLabels,
  putWarehouse,
  WarehouseBack,
  PickWork,
  postWarehouse,
  stringField,
  useWarehouseWorks,
  warehousePath,
  WarehouseForm,
  WarehouseSelect,
} from "./shared";

const path = warehousePath + "/equipment";
const options = Object.entries(conditionLabels).map(([value, label]) => ({
  value,
  label,
}));
const actions = {
  assign: "Asignación",
  return: "Devolución",
  condition: "Actualización",
  details: "Datos actualizados",
};

export function EquipmentList({
  selected,
  canManage = false,
}: {
  selected?: string;
  canManage?: boolean;
}) {
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const list = useAccountingQuery<Equipment[]>(selected ? "" : path);
  const detail = useAccountingQuery<Equipment>(
    selected ? `${path}/${selected}` : "",
  );
  if (selected)
    return (
      <QueryState {...detail}>
        {detail.data && (
          <EquipmentDetail
            row={detail.data}
            refresh={detail.refresh}
            canManage={canManage}
          />
        )}
      </QueryState>
    );
  const rows =
    list.data?.filter(
      (row) =>
        `${row.code} ${row.name} ${row.location} ${row.assignment?.workName ?? ""} ${row.assignment?.responsible ?? ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase().trim()) &&
        (!category ||
          (category === "unclassified"
            ? !row.category
            : row.category === category)) &&
        (!status ||
          (status === "assigned"
            ? !!row.assignment
            : status === "available"
              ? !row.assignment && row.condition === "good"
              : row.condition === status)),
    ) || [];
  return (
    <section className="warehouse-section">
      <header className="accounting-section-head">
        <h2>Equipos y herramientas</h2>
        <div className="accounting-tools">
          <Refresh loading={list.loading} onClick={list.refresh} />
          <Button
            type="button"
            disabled={!canManage}
            onClick={() => setCreate(true)}
          >
            <Plus size={16} /> Nuevo equipo
          </Button>
        </div>
      </header>
      <div className="warehouse-filters">
        <Field label="Buscar equipo">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, equipo, ubicación o responsable"
          />
        </Field>
        <WarehouseSelect
          label="Categoría"
          value={category}
          onChange={setCategory}
          options={[
            { value: "", label: "Todas las categorías" },
            ...EQUIPMENT_CATEGORIES.map((c) => ({
              value: c.id,
              label: c.name,
            })),
            { value: "unclassified", label: "Sin clasificar" },
          ]}
        />
        <WarehouseSelect
          label="Disponibilidad"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Todos los equipos" },
            { value: "available", label: "Disponibles en almacén" },
            { value: "assigned", label: "Asignados a obra" },
            { value: "maintenance", label: "En mantenimiento" },
            { value: "retired", label: "Retirados" },
          ]}
        />
      </div>
      {list.data && list.data.length > 0 && !list.loading && !rows.length && (
        <p className="hint">No hay equipos con estos filtros.</p>
      )}
      <QueryState
        {...list}
        empty={
          search
            ? "No encontramos equipos con esa búsqueda."
            : "Todavía no hay equipos registrados."
        }
      >
        {Boolean(rows.length) && (
          <ul className="warehouse-records equipment-records">
            {rows.map((row) => (
              <li key={row.id}>
                <a
                  href={`#inventory/equipos/${row.id}`}
                  className="warehouse-record"
                >
                  <div className="warehouse-record-head">
                    {row.category === "machine" ? (
                      <Cog size={20} aria-hidden="true" />
                    ) : row.category === "support" ? (
                      <Boxes size={20} aria-hidden="true" />
                    ) : (
                      <Wrench size={20} aria-hidden="true" />
                    )}
                    <div>
                      <small>
                        {EQUIPMENT_CATEGORIES.find((c) => c.id === row.category)
                          ?.name || "Sin clasificar"}{" "}
                        · {row.code}
                      </small>
                      <strong>{row.name}</strong>
                    </div>
                    <span className="ops-stock-status">
                      {conditionLabels[row.condition]}
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </div>
                  <dl className="equipment-custody">
                    <div>
                      <dt>
                        <MapPin size={15} /> Ubicación actual
                      </dt>
                      <dd>{row.assignment?.workName || row.location}</dd>
                    </div>
                    <div>
                      <dt>
                        <UserRound size={15} /> Responsable
                      </dt>
                      <dd>{row.assignment?.responsible || "Sin asignar"}</dd>
                    </div>
                  </dl>
                  <small>
                    {row.assignment
                      ? "Asignado a obra · Ver seguimiento"
                      : "En almacén · Ver ficha"}
                  </small>
                </a>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {create && (
        <NewEquipment
          close={() => setCreate(false)}
          done={(row) => {
            setCreate(false);
            location.hash = `inventory/equipos/${row.id}`;
          }}
        />
      )}
    </section>
  );
}

function NewEquipment({
  close,
  done,
  row,
}: {
  close: () => void;
  done: (row: Equipment) => void;
  row?: Equipment;
}) {
  const id = useRef(recordId());
  const [condition, setCondition] = useState(row?.condition || "good");
  const [category, setCategory] = useState(row?.category || "");
  return (
    <WarehouseForm
      title={row ? "Editar equipo" : "Nuevo equipo"}
      action={row ? "Guardar cambios" : "Registrar equipo"}
      onClose={close}
      canSubmit={!!category}
      save={async (form) => {
        done(
          await (row ? putWarehouse<Equipment> : postWarehouse<Equipment>)(
            row ? `${path}/${row.id}` : path,
            {
              ...(row ? { version: row.version } : { id: id.current }),
              category,
              code: stringField(form, "code"),
              name: stringField(form, "name"),
              location: stringField(form, "location"),
              ...(!row ? { condition } : {}),
            },
          ),
        );
      }}
    >
      <div className="warehouse-grid">
        <Field label="Código">
          <input name="code" defaultValue={row?.code} maxLength={60} required />
        </Field>
        <Field label="Nombre">
          <input
            name="name"
            defaultValue={row?.name}
            maxLength={150}
            required
          />
        </Field>
        <WarehouseSelect
          label="Categoría"
          value={category}
          onChange={setCategory}
          options={EQUIPMENT_CATEGORIES.map((c) => ({
            value: c.id,
            label: c.name,
          }))}
          placeholder="Selecciona una categoría"
        />
        <Field
          label="Ubicación en almacén"
          hint={
            row?.assignment
              ? "La ubicación actual sigue siendo la obra asignada."
              : undefined
          }
        >
          <input
            name="location"
            defaultValue={row?.location}
            maxLength={150}
            required
          />
        </Field>
        {!row && (
          <WarehouseSelect
            label="Estado"
            value={condition}
            options={options}
            onChange={(v) => setCondition(v as Equipment["condition"])}
          />
        )}
      </div>
    </WarehouseForm>
  );
}

function EquipmentDetail({
  row,
  refresh,
  canManage,
}: {
  row: Equipment;
  refresh: () => void;
  canManage: boolean;
}) {
  const [action, setAction] = useState<"assign" | "return" | "condition">();
  const [editing, setEditing] = useState(false);
  return (
    <section className="warehouse-section">
      <WarehouseBack href="#inventory/equipos">Volver a equipos</WarehouseBack>
      <header className="accounting-section-head">
        <div>
          <h2>{row.name}</h2>
          <p className="hint">
            {row.code} ·{" "}
            {EQUIPMENT_CATEGORIES.find((c) => c.id === row.category)?.name ||
              "Sin clasificar"}{" "}
            · {conditionLabels[row.condition]}
          </p>
        </div>
        <div className="accounting-tools">
          {canManage && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Editar datos
            </Button>
          )}
          {canManage &&
            (row.assignment ? (
              <Button onClick={() => setAction("return")}>
                Registrar devolución
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setAction("condition")}>
                  Actualizar estado
                </Button>
                <Button
                  disabled={row.condition !== "good"}
                  onClick={() => setAction("assign")}
                >
                  Asignar a obra
                </Button>
              </>
            ))}
        </div>
      </header>
      <dl className="equipment-custody warehouse-preview">
        <div>
          <dt>
            <MapPin size={15} />
            Ubicación actual
          </dt>
          <dd>{row.assignment?.workName || row.location}</dd>
        </div>
        <div>
          <dt>
            <UserRound size={15} />
            Responsable
          </dt>
          <dd>{row.assignment?.responsible || "Sin asignar"}</dd>
        </div>
      </dl>
      {row.assignment?.expectedReturn && (
        <p className="hint">
          Devolución prevista ·{" "}
          {row.assignment.expectedReturn.split("-").reverse().join("/")}
        </p>
      )}
      <h3>Historial</h3>
      {row.events.length ? (
        <ul className="warehouse-list">
          {[...row.events].reverse().map((event, index) => (
            <li key={index}>
              <div>
                <strong>
                  {actions[event.action]}
                  {event.workName && ` · ${event.workName}`}
                </strong>
                <small>
                  {[
                    event.responsible,
                    event.location,
                    event.condition && conditionLabels[event.condition],
                    event.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>
                  {date(event.at)} · {event.actor}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Sin movimientos registrados.</p>
      )}
      {editing && (
        <NewEquipment
          row={row}
          close={() => setEditing(false)}
          done={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {action && (
        <EquipmentAction
          row={row}
          action={action}
          close={() => setAction(undefined)}
          done={() => {
            setAction(undefined);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function EquipmentAction({
  row,
  action,
  close,
  done,
}: {
  row: Equipment;
  action: "assign" | "return" | "condition";
  close: () => void;
  done: () => void;
}) {
  const works = useWarehouseWorks();
  const [work, setWork] = useState("");
  const [condition, setCondition] = useState<Equipment["condition"]>(
    row.condition,
  );
  const title = {
    assign: "Asignar a obra",
    return: "Registrar devolución",
    condition: "Actualizar estado",
  }[action];
  return (
    <WarehouseForm
      title={title}
      action={title}
      onClose={close}
      save={async (form) => {
        if (action === "assign" && !work)
          throw new Error("Selecciona una obra.");
        await postWarehouse(path + `/${row.id}`, {
          action,
          version: row.version,
          note: stringField(form, "note"),
          ...(action === "assign"
            ? {
                workId: work,
                responsible: stringField(form, "responsible"),
                expectedReturn: stringField(form, "expectedReturn"),
              }
            : { location: stringField(form, "location"), condition }),
        });
        done();
      }}
    >
      {action === "assign" ? (
        <>
          {works.error && <Notice error>{works.error}</Notice>}
          <PickWork
            works={works.data?.filter((row) => row.stage !== "completed") || []}
            value={work}
            onChange={setWork}
          />
          <Field label="Responsable">
            <input name="responsible" maxLength={100} required />
          </Field>
          <Field label="Devolución prevista">
            <input type="date" name="expectedReturn" required />
          </Field>
        </>
      ) : (
        <>
          <Field label="Ubicación">
            <input
              name="location"
              defaultValue={row.location}
              maxLength={150}
              required
            />
          </Field>
          <WarehouseSelect
            label="Estado"
            value={condition}
            options={options}
            onChange={(value) => setCondition(value as Equipment["condition"])}
          />
        </>
      )}
      <Field
        label={
          action === "condition"
            ? "Motivo del cambio"
            : "Observación (opcional)"
        }
      >
        <textarea
          name="note"
          rows={2}
          required={action === "condition"}
          maxLength={500}
        />
      </Field>
    </WarehouseForm>
  );
}
