import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import {
  employeeInput,
  payrollInput,
  type EmployeeInput,
  type LaborEmployee,
  type LaborRegime,
  type PayrollLineInput,
  type PayrollRun,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field } from "../../../components/ui";
import { today } from "../accounting-shared";
import {
  field,
  healthLabels,
  LaborForm,
  money,
  MoneyField,
  pensionLabels,
  saveLabor,
  validate,
} from "./labor-shared";

import { laborPeriod } from "./LaborRecords";

type FormActions = { close: () => void; saved: (message: string) => void };
const choices = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export function EmployeeForm({
  employee,
  regimes,
  close,
  saved,
}: FormActions & { employee?: LaborEmployee; regimes: LaborRegime[] }) {
  const [document, setDocument] = useState(employee?.documentType || "DNI");
  const [pension, setPension] = useState<EmployeeInput["pensionSystem"]>(
    employee?.pensionSystem || "onp",
  );
  const [regime, setRegime] = useState(
    regimes.find(
      (item) => item.code === (employee?.laborRegime || "general"),
    ) || regimes[0],
  );
  const [health, setHealth] = useState(
    employee?.healthSystem || regime?.defaultHealthSystem,
  );
  return (
    <LaborForm
      title={employee ? "Editar trabajador" : "Nuevo trabajador"}
      description="Estos datos se usan para calcular la planilla."
      label="Guardar trabajador"
      onClose={close}
      onSaved={() => saved("Trabajador guardado.")}
      onSave={(form) => {
        const input = validate(employeeInput, {
          name: field(form, "name"),
          documentType: document,
          documentNumber: field(form, "document"),
          position: field(form, "position"),
          hireDate: field(form, "hire"),
          endDate: field(form, "end") || undefined,
          salaryCents: money(form, "salary"),
          pensionSystem: pension,
          laborRegime: regime?.code,
          healthSystem: health,
          regimeReference: field(form, "regimeReference"),
          active: form.has("active"),
        });
        return employee
          ? saveLabor(
              "/employees/" + employee.id,
              { ...input, revision: employee.revision },
              "PUT",
            )
          : saveLabor("/employees", input);
      }}
    >
      {(changed) => (
        <>
          <Field label="Nombre completo">
            <input
              name="name"
              defaultValue={employee?.name}
              maxLength={180}
              required
            />
          </Field>
          <div className="labor-grid">
            <Field label="Documento">
              <Select
                label="Tipo de documento"
                value={document}
                options={choices({ DNI: "DNI", CE: "Carné de extranjería" })}
                onChange={(value) => {
                  setDocument(value as typeof document);
                  changed();
                }}
              />
            </Field>
            <Field label="Número de documento">
              <input
                name="document"
                defaultValue={employee?.documentNumber}
                inputMode={document === "DNI" ? "numeric" : "text"}
                pattern={document === "DNI" ? "[0-9]{8}" : "[A-Za-z0-9]{6,15}"}
                maxLength={document === "DNI" ? 8 : 15}
                required
              />
            </Field>
            <Field label="Cargo">
              <input
                name="position"
                defaultValue={employee?.position}
                maxLength={120}
              />
            </Field>
            <MoneyField
              label="Sueldo mensual"
              name="salary"
              cents={employee?.salaryCents}
              required
            />
            <Field label="Fecha de ingreso">
              <input
                name="hire"
                type="date"
                defaultValue={employee?.hireDate || today()}
                required
              />
            </Field>
            <Field label="Fecha de cese">
              <input name="end" type="date" defaultValue={employee?.endDate} />
            </Field>
            <Field label="Régimen laboral">
              <Select
                label="Régimen laboral"
                value={regime?.code || ""}
                options={regimes.map(({ code, label }) => ({
                  value: code,
                  label,
                }))}
                onChange={(value) => {
                  const next = regimes.find((item) => item.code === value)!;
                  setRegime(next);
                  setHealth(next.defaultHealthSystem);
                  changed();
                }}
              />
            </Field>
            <Field label="Afiliación de salud">
              <Select
                label="Afiliación de salud"
                value={health || ""}
                options={(regime?.healthSystems || []).map((value) => ({
                  value,
                  label: healthLabels[value],
                }))}
                onChange={(value) => {
                  setHealth(value as typeof health);
                  changed();
                }}
              />
            </Field>
            <Field label="Sistema de pensión">
              <Select
                label="Sistema de pensión"
                value={pension}
                options={choices(pensionLabels)}
                onChange={(value) => {
                  setPension(value as typeof pension);
                  changed();
                }}
              />
            </Field>
            <Field
              label="Referencia del régimen"
              hint={
                regime?.requiresReference
                  ? "Indica la inscripción REMYPE, norma o convenio aplicable."
                  : undefined
              }
            >
              <input
                name="regimeReference"
                defaultValue={employee?.regimeReference}
                maxLength={240}
                required={regime?.requiresReference}
              />
            </Field>
          </div>
          {regime?.guidance && <p className="hint">{regime.guidance}</p>}
          <label className="labor-check">
            <input
              name="active"
              type="checkbox"
              defaultChecked={employee?.active ?? true}
            />{" "}
            Trabajador activo
          </label>
        </>
      )}
    </LaborForm>
  );
}

const extraFields = [
  ["taxableExtraCents", "Bonos y otros extras afectos"],
  ["nonTaxableCents", "Bonos e ingresos no afectos"],
  ["afpDeductionCents", "Descuento previsional (AFP o especial)"],
  ["employerContributionCents", "Aporte de salud del empleador"],
  ["gratuityCents", "Gratificación"],
  ["ctsCents", "CTS"],
  ["vacationCents", "Vacaciones"],
  ["fifthCategoryCents", "Retención de quinta categoría"],
  ["otherDeductionCents", "Otros descuentos manuales"],
] as const;

export function PayrollForm({
  run,
  period,
  employees,
  close,
  saved,
}: FormActions & {
  run?: PayrollRun;
  period: string;
  employees: LaborEmployee[];
}) {
  const [workers, setWorkers] = useState(
    () => run?.lines.map((line) => line.employeeId) || [],
  );
  const [worker, setWorker] = useState("");

  const lastDay = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0),
  ).getUTCDate();
  const firstDate = period + "-01";
  const lastDate = period + "-" + lastDay;
  const options = employees
    .filter(
      (employee) =>
        !workers.includes(employee.id) &&
        employee.hireDate <= lastDate &&
        (!employee.endDate || employee.endDate >= firstDate),
    )
    .map((employee) => ({
      value: employee.id,
      label: employee.name,
      description: employee.active ? employee.position : "Inactivo",
    }));
  return (
    <LaborForm
      title={run ? "Editar planilla" : "Preparar planilla"}
      wide
      description={`${laborPeriod(period)} · Agrega a los trabajadores y guarda el borrador para revisar los importes.`}
      label="Calcular y guardar borrador"
      validateForm={() => workers.length > 0}
      onClose={close}
      onSaved={() => saved("Borrador calculado y guardado.")}
      onSave={(form) => {
        if (!workers.length) throw new Error("Agrega al menos un trabajador.");
        const lines = workers.map((employeeId) => ({
          employeeId,
          days: Number(field(form, employeeId + "_days")),
          ...Object.fromEntries(
            extraFields.map(([key]) => [
              key,
              money(form, employeeId + "_" + key),
            ]),
          ),
        })) as PayrollLineInput[];
        const input = validate(payrollInput, {
          period,
          minimumWageCents: money(form, "minimum"),
          lines,
        });
        return run
          ? saveLabor(
              "/runs/" + run.id,
              { ...input, revision: run.revision, manualOtherDeductions: true },
              "PUT",
            )
          : saveLabor("/runs", input);
      }}
    >
      {(changed) => (
        <>
          <MoneyField
            label="Remuneración mínima aplicable (S/)"
            name="minimum"
            cents={run?.minimumWageCents}
            required
          />
          <div className="labor-add">
            <Select
              label="Trabajador para agregar"
              value={worker}
              options={options}
              onChange={setWorker}
              placeholder={
                options.length
                  ? "Selecciona un trabajador"
                  : "Sin trabajadores disponibles"
              }
              disabled={!options.length}
            />
            <Button
              type="button"
              variant="ghost"
              disabled={!worker}
              onClick={() => {
                setWorkers([...workers, worker]);
                setWorker("");
                changed();
              }}
            >
              <UserPlus size={16} /> Agregar
            </Button>
          </div>
          {workers.map((id) => {
            const line = run?.lines.find((entry) => entry.employeeId === id);
            const employee = employees.find((entry) => entry.id === id);
            const name = employee?.name || line?.employeeName;
            const start =
              employee && employee.hireDate > firstDate
                ? Number(employee.hireDate.slice(-2))
                : 1;
            const end =
              employee?.endDate && employee.endDate < lastDate
                ? Number(employee.endDate.slice(-2))
                : lastDay;
            const maxDays =
              start === 1 && end === lastDay
                ? 30
                : Math.max(0, Math.min(30, end - start + 1));
            const needsPension = employee && employee.pensionSystem !== "onp";
            const needsHealth = employee && employee.healthSystem !== "essalud";
            return (
              <section className="labor-form-card" key={id} aria-label={name}>
                <div className="labor-row-head">
                  <strong>{name}</strong>
                  <button
                    className="ops-icon-button"
                    type="button"
                    aria-label={"Quitar a " + name}
                    onClick={() => {
                      setWorkers(workers.filter((entry) => entry !== id));
                      changed();
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
                <Field label="Días en planilla">
                  <input
                    name={id + "_days"}
                    type="number"
                    min={0}
                    max={Math.max(maxDays, line?.days ?? 0)}
                    step={1}
                    defaultValue={line?.days ?? maxDays}
                    required
                  />
                </Field>
                <div className="labor-grid">
                  {extraFields
                    .filter(
                      ([key]) =>
                        key === "taxableExtraCents" ||
                        key === "nonTaxableCents",
                    )
                    .map(([key, label]) => (
                      <MoneyField
                        key={key}
                        label={label}
                        name={id + "_" + key}
                        cents={line?.[key]}
                      />
                    ))}
                </div>
                <details
                  className="labor-extra"
                  open={
                    needsPension ||
                    needsHealth ||
                    Boolean(line?.afpDeductionCents) ||
                    undefined
                  }
                >
                  <summary>Bonos, beneficios y descuentos</summary>
                  <div className="labor-grid">
                    {extraFields
                      .filter(
                        ([key]) =>
                          key !== "taxableExtraCents" &&
                          key !== "nonTaxableCents" &&
                          (key !== "afpDeductionCents" ||
                            needsPension ||
                            Boolean(line?.afpDeductionCents)) &&
                          (key !== "employerContributionCents" ||
                            needsHealth ||
                            Boolean(line?.employerContributionCents)),
                      )
                      .map(([key, label]) => (
                        <MoneyField
                          key={key}
                          label={label}
                          name={id + "_" + key}
                          cents={
                            key === "otherDeductionCents" && line
                              ? Math.max(
                                  0,
                                  line.otherDeductionCents -
                                    (run?.workDeductions || [])
                                      .filter((i) => i.employeeId === id)
                                      .reduce((s, i) => s + i.cents, 0),
                                )
                              : line?.[key]
                          }
                        />
                      ))}
                  </div>
                </details>
              </section>
            );
          })}
        </>
      )}
    </LaborForm>
  );
}
