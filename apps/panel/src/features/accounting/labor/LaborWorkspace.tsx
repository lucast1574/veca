import {
  EmployeeAccountDialog,
  ApprovePayrollDeductionDialog,
  incidentState,
} from "./PersonnelDialogs";
import "./personnel.css";
import { useState } from "react";
import { FileText, Plus, Users, Wallet } from "lucide-react";
import {
  laborSourceKey,
  payrollLineCost,
  splitLaborCost,
  type LaborSource,
  type LaborWorkspace as Ledger,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../../components/ui";
import {
  amount,
  QueryState,
  Refresh,
  today,
  useAccountingQuery,
} from "../accounting-shared";
import { EmployeeForm, PayrollForm } from "./PayrollForms";
import {
  HonorariumForm,
  LaborPaymentForm,
  LaborStatusForm,
} from "./HonorariumForms";
import { LaborAllocationForm } from "./LaborAllocationForm";
import {
  Metrics,
  payrollEffective,
  PayrollRecords,
  ReceiptRecords,
  type Dialog,
} from "./LaborRecords";
import { useLiveRefresh } from "../../operations/shared";
import { laborPath } from "./labor-shared";
import "./labor.css";

const monthFormatter = new Intl.DateTimeFormat("es-PE", {
  month: "long",
  timeZone: "UTC",
});
const months = Array.from({ length: 12 }, (_, index) => {
  const month = monthFormatter.format(new Date(Date.UTC(2026, index, 1)));
  return {
    value: String(index + 1).padStart(2, "0"),
    label: month[0].toUpperCase() + month.slice(1),
  };
});

const sections = [
  { id: "runs", label: "Planilla", Icon: Wallet },
  { id: "receipts", label: "Honorarios", Icon: FileText },
  { id: "employees", label: "Trabajadores", Icon: Users },
  { id: "incidents", label: "Descuentos al personal", Icon: FileText },
] as const;
type Section = (typeof sections)[number]["id"];
export function LaborWorkspace({
  initialPeriod,
  initialDiscounts = false,
}: { initialPeriod?: string; initialDiscounts?: boolean } = {}) {
  const [section, setSection] = useState<Section>(
    initialDiscounts ? "incidents" : "runs",
  );
  const [period, setPeriod] = useState(initialPeriod || today().slice(0, 7));
  const [year, month] = period.split("-");
  const latestYear = Math.max(Number(today().slice(0, 4)) + 1, Number(year));
  const years = Array.from({ length: latestYear - 1999 }, (_, index) => {
    const value = String(latestYear - index);
    return { value, label: value };
  });
  const [dialog, setDialog] = useState<Dialog>();
  const [feedback, setFeedback] = useState("");
  const query = useAccountingQuery<Ledger>(laborPath + "?period=" + period);
  useLiveRefresh(query.refresh, false, true, "/account/notifications/events");
  const data = query.data;
  const pendingCount =
    data?.incidents?.filter(
      (incident) =>
        !incident.payrollRunId &&
        (incident.status === "authorized" || incident.status === "approved"),
    ).length || 0;
  const allocations = new Map(
    data?.allocations.map((row) => [laborSourceKey(row.source), row]),
  );
  const allocation = (source: LaborSource) =>
    allocations.get(laborSourceKey(source));
  const assigned = (source: LaborSource, cost: number) =>
    splitLaborCost(cost, allocation(source)?.rows || []).reduce(
      (sum, row) => sum + row.cents,
      0,
    );
  let payroll = 0;
  let fees = 0;
  let distributed = 0;
  for (const run of data?.runs.filter(payrollEffective) || []) {
    for (const line of run.lines) {
      const cost = payrollLineCost(line);
      payroll += cost;
      distributed += assigned(
        { kind: "payroll", id: run.id, employeeId: line.employeeId },
        cost,
      );
    }
  }
  for (const receipt of data?.receipts.filter(
    (row) => row.status === "registered",
  ) || []) {
    fees += receipt.grossCents;
    distributed += assigned(
      { kind: "fee", id: receipt.id },
      receipt.grossCents,
    );
  }
  const canWrite = Boolean(data && !query.loading && !query.error);
  const close = () => setDialog(undefined);
  const saved = (message: string) => {
    close();
    setFeedback(message);
    query.refresh();
  };
  const open = (next: Dialog) => {
    setFeedback("");
    setDialog(next);
  };
  const runExists = data?.runs.some((run) => run.status !== "void");
  return (
    <section className="labor-workspace" aria-labelledby="labor-title">
      <header className="accounting-section-head">
        <div>
          <h2 id="labor-title">Planilla y honorarios</h2>
          <p className="hint">
            Calcula la planilla en API SUNAT, registra los recibos de
            profesionales y reparte los costos entre las obras.
          </p>
        </div>
        <div className="accounting-tools">
          <Field label="Mes">
            <Select
              label="Mes del periodo"
              value={month}
              options={months}
              onChange={(next) => {
                setFeedback("");
                setPeriod(year + "-" + next);
              }}
            />
          </Field>
          <Field label="Año">
            <Select
              label="Año del periodo"
              value={year}
              options={years}
              onChange={(next) => {
                setFeedback("");
                setPeriod(next + "-" + month);
              }}
            />
          </Field>
          <Refresh loading={query.loading} onClick={query.refresh} />
        </div>
      </header>
      {feedback && <Notice>{feedback}</Notice>}
      <QueryState {...query}>
        {data && (
          <>
            <Metrics
              entries={[
                ["Costo de planilla", payroll],
                ["Honorarios registrados", fees],
                ["Asignado a obras", distributed],
                ["Sin asignar", payroll + fees - distributed],
              ]}
            />
            <section className="labor-ledger">
              <div className="labor-toolbar">
                <nav aria-label="Registros de personal">
                  {sections.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={section === id}
                      aria-label={
                        id === "incidents" && pendingCount
                          ? `${label}, ${pendingCount} ${pendingCount === 1 ? "pendiente" : "pendientes"}`
                          : label
                      }
                      onClick={() => setSection(id)}
                    >
                      <Icon size={17} aria-hidden="true" /> {label}
                      {id === "incidents" && pendingCount > 0 && (
                        <span
                          className="labor-pending-count"
                          aria-hidden="true"
                        >
                          {pendingCount > 99 ? "99+" : pendingCount}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
                {section === "runs" && !runExists && (
                  <Button
                    disabled={!canWrite || !data.employees.length}
                    onClick={() => open({ kind: "payroll" })}
                  >
                    <Plus size={16} /> Preparar planilla
                  </Button>
                )}
                {section === "receipts" && (
                  <Button
                    disabled={!canWrite}
                    onClick={() => open({ kind: "fee" })}
                  >
                    <Plus size={16} /> Nuevo recibo
                  </Button>
                )}

                {section === "employees" && (
                  <Button
                    disabled={!canWrite}
                    onClick={() => open({ kind: "employee" })}
                  >
                    <Plus size={16} /> Nuevo trabajador
                  </Button>
                )}
              </div>
              {section === "runs" && (
                <PayrollRecords
                  runs={data.runs}
                  allocation={allocation}
                  canWrite={canWrite}
                  open={open}
                  emptyWorkers={!data.employees.length}
                  showEmployees={() => setSection("employees")}
                />
              )}
              {section === "receipts" && (
                <ReceiptRecords
                  receipts={data.receipts}
                  allocation={allocation}
                  canWrite={canWrite}
                  open={open}
                />
              )}
              {section === "incidents" && (
                <div className="personnel-incidents">
                  <p className="hint">
                    Aprueba los descuentos sustentados del trabajador. Se
                    reflejarán automáticamente en su planilla; la obra indica
                    dónde ocurrió la incidencia.
                  </p>
                  {data.incidents?.length ? (
                    data.incidents.map((i) => (
                      <article key={i.id}>
                        <header>
                          <div>
                            <strong>{i.employeeName}</strong>
                            <small>
                              {i.workName} · {i.item}
                            </small>
                          </div>
                          <strong>{amount(i.cents)}</strong>
                        </header>
                        <p>{i.reason}</p>
                        <footer>
                          <span
                            className="labor-status"
                            data-state={
                              i.status === "approved" || i.payrollRunId
                                ? "approved"
                                : "draft"
                            }
                          >
                            {incidentState(i)}
                          </span>
                          <div className="personnel-actions">
                            {!i.payrollRunId &&
                              (i.status === "authorized" ||
                                (i.status === "approved" &&
                                  data.runs.some(
                                    (run) =>
                                      run.status === "draft" &&
                                      run.lines.some(
                                        (line) =>
                                          line.employeeId === i.employeeId,
                                      ),
                                  ))) && (
                                <Button
                                  disabled={!canWrite}
                                  onClick={() =>
                                    open({
                                      kind: "deductionApproval",
                                      record: i,
                                    })
                                  }
                                >
                                  {i.status === "approved"
                                    ? "Reintentar actualización"
                                    : "Aprobar descuento"}
                                </Button>
                              )}
                            <a
                              className="warehouse-link"
                              href={`#works/${i.workId}`}
                            >
                              Abrir obra
                            </a>
                          </div>
                        </footer>
                        {i.authorization && (
                          <small>Sustento: {i.authorization.reference}</small>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="accounting-empty">
                      No hay incidencias de obra para este periodo.
                    </p>
                  )}
                </div>
              )}
              {section === "employees" &&
                (data.employees.length ? (
                  <ul className="labor-employees">
                    {data.employees.map((employee) => (
                      <li key={employee.id}>
                        <div>
                          <strong>{employee.name}</strong>
                          <small>
                            {employee.position ||
                              data.regimes.find(
                                (regime) =>
                                  regime.code === employee.laborRegime,
                              )?.label}
                          </small>
                          {employee.account?.userId && (
                            <small>
                              Cuenta VECA · {employee.account.userName}
                            </small>
                          )}
                        </div>
                        <strong>{amount(employee.salaryCents)}</strong>
                        <span
                          className="labor-status"
                          data-state={employee.active ? "approved" : "draft"}
                        >
                          {employee.active ? "Activo" : "Inactivo"}
                        </span>
                        <div className="personnel-actions">
                          <Button
                            variant="ghost"
                            disabled={!canWrite}
                            onClick={() =>
                              open({ kind: "account", record: employee })
                            }
                          >
                            Cuenta VECA
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!canWrite}
                            aria-label={"Editar a " + employee.name}
                            onClick={() =>
                              open({ kind: "employee", record: employee })
                            }
                          >
                            Editar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="accounting-empty">
                    Todavía no hay trabajadores. Registra a la primera persona
                    para preparar una planilla.
                  </p>
                ))}
            </section>
          </>
        )}
      </QueryState>
      {data && dialog?.kind === "account" && (
        <EmployeeAccountDialog
          employee={dialog.record}
          close={close}
          done={() =>
            saved(
              "Cuenta vinculada. La persona verá su información en Mi perfil.",
            )
          }
        />
      )}
      {data && dialog?.kind === "deductionApproval" && (
        <ApprovePayrollDeductionDialog
          incident={dialog.record}
          close={close}
          done={(applied) =>
            saved(
              applied
                ? "Descuento aprobado y reflejado en la planilla del trabajador."
                : "Descuento aprobado. Se aplicará automáticamente al preparar la planilla del mes.",
            )
          }
        />
      )}
      {data && dialog?.kind === "employee" && (
        <EmployeeForm
          employee={dialog.record}
          regimes={data.regimes}
          close={close}
          saved={saved}
        />
      )}
      {data && dialog?.kind === "payroll" && (
        <PayrollForm
          run={dialog.record}
          period={period}
          employees={data.employees}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "fee" && (
        <HonorariumForm
          receipt={dialog.record}
          period={period}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "payment" && (
        <LaborPaymentForm record={dialog.record} close={close} saved={saved} />
      )}
      {dialog?.kind === "state" && (
        <LaborStatusForm
          record={dialog.record}
          status={dialog.status}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "allocation" && (
        <LaborAllocationForm
          target={dialog.target}
          current={allocation(dialog.target.source)}
          close={close}
          saved={saved}
        />
      )}
      <a
        className="accounting-inline labor-margin-link"
        href="#accounting/margen"
      >
        Consultar margen por obra
      </a>
    </section>
  );
}
