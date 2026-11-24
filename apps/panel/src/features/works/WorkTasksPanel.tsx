import { useRef, useState } from "react";
import {
  workTaskStatusLabels as states,
  type Lead,
  type SessionUser,
  type WorkTask,
} from "@veca/content";
import { Plus } from "lucide-react";
import { Button, Field } from "../../components/ui";
import { Select } from "@veca/ui/src/Select";
import { api } from "../../lib/api";
import {
  QueryState,
  today,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { WarehouseForm, stringField } from "../warehouse/shared";
import { useLiveRefresh } from "../operations/shared";
import "../warehouse/warehouse.css";
type TaskPage = {
  items: WorkTask[];
  version: number;
  people: { id: string; name: string }[];
  stage: string;
  review?: Lead["completionReview"];
  stageRequest?: Lead["stageRequest"];
};
export function WorkTasksPanel({
  id,
  user,
  onSaved,
}: {
  id: string;
  user: SessionUser;
  onSaved: () => void;
}) {
  const path = `/admin/works/${id}`;
  const query = useAccountingQuery<TaskPage>(path + "/tasks");
  useLiveRefresh(query.refresh, false, true, "/admin/works/events");
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<WorkTask>();
  const manage = user.permissions.includes("works_manage");
  const report = user.permissions.includes("works_report") || manage;
  const done = () => {
    setCreate(false);
    setSelected(undefined);
    query.refresh();
    onSaved();
  };
  const data = query.data;
  return (
    <section className="ops-card work-tasks">
      <header className="lead-detail-section-head">
        <h2>Pendientes de la obra</h2>
        {manage && data?.stage !== "completed" && (
          <Button
            onClick={() => setCreate(true)}
            disabled={!data?.people.length}
          >
            <Plus size={16} /> Nuevo pendiente
          </Button>
        )}
      </header>
      <QueryState {...query}>
        {!data?.items.length && (
          <p className="hint">Aún no hay pendientes registrados.</p>
        )}
        <ul className="warehouse-list">
          {data?.items.map((task) => (
            <li key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>
                  {task.assignedName} ·{" "}
                  {task.dueDate.split("-").reverse().join("/")}
                </small>
                {task.status !== "done" && task.dueDate < today() && (
                  <small className="work-overdue">Vencido</small>
                )}
                {task.observation && <p>{task.observation}</p>}
              </div>
              <span
                className={`ops-stock-status${task.status === "blocked" ? " low" : task.status === "done" ? "" : " work-task-neutral"}`}
              >
                {states[task.status]}
              </span>
              {data.stage !== "completed" &&
                (manage || (report && task.assignedTo === user.id)) && (
                  <Button variant="ghost" onClick={() => setSelected(task)}>
                    Actualizar
                  </Button>
                )}
            </li>
          ))}
        </ul>
        {data?.review && !data.stageRequest && (
          <p className="hint">Revisión final solicitada · {data.review.note}</p>
        )}
      </QueryState>
      {create && data && (
        <NewTask
          data={data}
          path={path}
          close={() => setCreate(false)}
          done={done}
        />
      )}
      {selected && data && (
        <TaskStatus
          people={data.people}
          manage={manage}
          task={selected}
          version={data.version}
          path={path}
          close={() => setSelected(undefined)}
          done={done}
        />
      )}
    </section>
  );
}
function NewTask({
  data,
  path,
  close,
  done,
}: {
  data: TaskPage;
  path: string;
  close: () => void;
  done: () => void;
}) {
  const id = useRef(crypto.randomUUID());
  const version = useRef(data.version);
  const [assigned, setAssigned] = useState("");
  return (
    <WarehouseForm
      title="Nuevo pendiente"
      action="Asignar pendiente"
      onClose={close}
      canSubmit={!!assigned}
      save={async (form) => {
        await api(path + "/tasks", {
          method: "POST",
          body: JSON.stringify({
            id: id.current,
            version: version.current,
            title: stringField(form, "title"),
            assignedTo: assigned,
            dueDate: stringField(form, "dueDate"),
          }),
        });
        done();
      }}
    >
      <Field label="Qué hay que hacer">
        <input name="title" required minLength={3} maxLength={160} />
      </Field>
      <Field label="Responsable">
        <Select
          floating
          label="Responsable"
          value={assigned}
          options={data.people.map((person) => ({
            value: person.id,
            label: person.name,
          }))}
          onChange={setAssigned}
        />
      </Field>
      <Field label="Fecha límite">
        <input type="date" name="dueDate" required />
      </Field>
    </WarehouseForm>
  );
}
function TaskStatus({
  task,
  version,
  path,
  close,
  done,
  people,
  manage,
}: {
  people: TaskPage["people"];
  manage: boolean;
  task: WorkTask;
  version: number;
  path: string;
  close: () => void;
  done: () => void;
}) {
  const [status, setStatus] = useState(task.status);
  const expectedVersion = useRef(version);
  const [assignedTo, setAssigned] = useState(task.assignedTo);
  return (
    <WarehouseForm
      title={task.title}
      action="Guardar estado"
      onClose={close}
      save={async (form) => {
        await api(path + "/tasks/" + task.id, {
          method: "PUT",
          body: JSON.stringify({
            version: expectedVersion.current,
            status,
            ...(manage ? { assignedTo } : {}),
            observation: stringField(form, "observation"),
          }),
        });
        done();
      }}
    >
      {manage && (
        <Field label="Responsable">
          <Select
            floating
            label="Responsable"
            value={assignedTo}
            onChange={setAssigned}
            options={people.map((person) => ({
              value: person.id,
              label: person.name,
            }))}
          />
        </Field>
      )}
      <Field label="Estado">
        <Select
          floating
          label="Estado"
          value={status}
          onChange={(value) => setStatus(value as WorkTask["status"])}
          options={Object.entries(states).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </Field>
      <Field
        label={status === "blocked" ? "Qué impide continuar" : "Observación"}
      >
        <textarea
          name="observation"
          rows={3}
          defaultValue={task.observation}
          required={status === "blocked"}
          minLength={status === "blocked" ? 5 : undefined}
          maxLength={1000}
        />
      </Field>
    </WarehouseForm>
  );
}
