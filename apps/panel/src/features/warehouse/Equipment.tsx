import { useRef, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import type { Equipment } from "@veca/content";
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
};

export function EquipmentList({ selected }: { selected?: string }) {
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState("");
  const list = useAccountingQuery<Equipment[]>(selected ? "" : path);
  const detail = useAccountingQuery<Equipment>(
    selected ? `${path}/${selected}` : "",
  );
  if (selected)
    return (
      <QueryState {...detail}>
        {detail.data && (
          <EquipmentDetail row={detail.data} refresh={detail.refresh} />
        )}
      </QueryState>
    );
  const rows =
    list.data?.filter((row) =>
      `${row.code} ${row.name} ${row.assignment?.workName ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase().trim()),
    ) || [];
  return (
    <section className="warehouse-section">
      <header className="accounting-section-head">
        <h2>Equipos y herramientas</h2>
        <div className="accounting-tools">
          <Refresh loading={list.loading} onClick={list.refresh} />
          <Button type="button" onClick={() => setCreate(true)}>
            <Plus size={16} /> Nuevo equipo
          </Button>
        </div>
      </header>
      <Field label="Buscar equipo">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Código, equipo u obra"
        />
      </Field>
      <QueryState
        {...list}
        empty={
          search
            ? "No encontramos equipos con esa búsqueda."
            : "Todavía no hay equipos registrados."
        }
      >
        {Boolean(rows.length) && (
          <ul className="warehouse-list">
            {rows.map((row) => (
              <li key={row.id}>
                <Wrench size={18} aria-hidden="true" />
                <div>
                  <a href={`#inventory/equipos/${row.id}`}>
                    <strong>
                      {row.code} · {row.name}
                    </strong>
                  </a>
                  <small>
                    {row.assignment
                      ? `${row.assignment.workName} · ${row.assignment.responsible}`
                      : row.location}
                  </small>
                </div>
                <span className="ops-stock-status">
                  {row.assignment ? "Asignado" : conditionLabels[row.condition]}
                </span>
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
}: {
  close: () => void;
  done: (row: Equipment) => void;
}) {
  const id = useRef(recordId());
  const [condition, setCondition] = useState("good");
  return (
    <WarehouseForm
      title="Nuevo equipo"
      action="Registrar equipo"
      onClose={close}
      save={async (form) => {
        done(
          await postWarehouse<Equipment>(path, {
            id: id.current,
            code: stringField(form, "code"),
            name: stringField(form, "name"),
            location: stringField(form, "location"),
            condition,
          }),
        );
      }}
    >
      <div className="warehouse-grid">
        <Field label="Código">
          <input name="code" maxLength={60} required />
        </Field>
        <Field label="Nombre">
          <input name="name" maxLength={150} required />
        </Field>
        <Field label="Ubicación">
          <input name="location" maxLength={150} required />
        </Field>
        <WarehouseSelect
          label="Estado"
          value={condition}
          options={options}
          onChange={setCondition}
        />
      </div>
    </WarehouseForm>
  );
}

function EquipmentDetail({
  row,
  refresh,
}: {
  row: Equipment;
  refresh: () => void;
}) {
  const [action, setAction] = useState<keyof typeof actions>();
  return (
    <section className="warehouse-section">
      <a href="#inventory/equipos" className="warehouse-link">
        Volver a equipos
      </a>
      <header className="accounting-section-head">
        <div>
          <h2>{row.name}</h2>
          <p className="hint">
            {row.code} · {conditionLabels[row.condition]}
          </p>
        </div>
        <div className="accounting-tools">
          {row.assignment ? (
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
          )}
        </div>
      </header>
      <div className="warehouse-preview">
        <strong>
          {row.assignment ? row.assignment.workName : row.location}
        </strong>
        <p>
          {row.assignment
            ? `A cargo de ${row.assignment.responsible}`
            : "Ubicación registrada"}
        </p>
      </div>
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
  action: keyof typeof actions;
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
            ? { workId: work, responsible: stringField(form, "responsible") }
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
