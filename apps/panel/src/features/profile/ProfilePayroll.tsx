import { useState } from "react";
import { Wallet, ChevronDown } from "lucide-react";
import type { MyPayroll } from "@veca/content";
import { Field } from "../../components/ui";
import { Select } from "@veca/ui/src/Select";
import {
  amount,
  QueryState,
  Refresh,
  today,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { incidentState } from "../accounting/labor/PersonnelDialogs";
import "../accounting/labor/personnel.css";
export function ProfilePayroll() {
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [year, month] = period.split("-");
  const query = useAccountingQuery<MyPayroll>(
    "/account/payroll?period=" + period,
  );
  if (query.data && !query.data.linked && !query.error) return null;
  const data = query.data?.linked ? query.data : null;
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: new Intl.DateTimeFormat("es-PE", {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, i, 1))),
  }));
  const y = Number(today().slice(0, 4));
  const years = Array.from({ length: y - 1999 }, (_, i) => ({
    value: String(y - i),
    label: String(y - i),
  }));
  return (
    <section className="profile-section payroll-profile">
      <header className="profile-section-heading">
        <Wallet size={20} />
        <div>
          <h2>Mi remuneración</h2>
          <p>Información privada de tu Planilla.</p>
        </div>
      </header>
      <div className="personnel-period">
        <Field label="Mes">
          <Select
            label="Mes de mi planilla"
            value={month}
            options={months}
            onChange={(m) => setPeriod(year + "-" + m)}
          />
        </Field>
        <Field label="Año">
          <Select
            label="Año de mi planilla"
            value={year}
            options={years}
            onChange={(y) => setPeriod(y + "-" + month)}
          />
        </Field>
        <Refresh loading={query.loading} onClick={query.refresh} />
      </div>
      <QueryState {...query}>
        {data && (
          <>
            <div className="payroll-profile-hero">
              <div>
                <span>
                  {!data.run
                    ? "Sueldo base registrado"
                    : data.run.status === "draft"
                      ? "Neto estimado · Por confirmar"
                      : "Neto de la planilla"}
                </span>
                <strong>
                  {amount(data.line?.netCents ?? data.salaryCents)}
                </strong>
                <small>
                  {!data.run
                    ? "Sin planilla registrada para este periodo"
                    : data.run.status === "paid"
                      ? `Pago registrado · ${data.run.paidAt}`
                      : data.run.status === "approved"
                        ? "Planilla aprobada · Pago pendiente"
                        : "Borrador de Planilla"}
                </small>
              </div>
              <p>
                {data.position}
                <br />
                {data.regimeLabel}
              </p>
            </div>
            {data.line && (
              <>
                <dl className="payroll-profile-totals">
                  <div>
                    <dt>Ingresos brutos</dt>
                    <dd>{amount(data.line.grossCents)}</dd>
                  </div>
                  <div>
                    <dt>Descuentos totales</dt>
                    <dd>{amount(data.line.grossCents - data.line.netCents)}</dd>
                  </div>
                  <div>
                    <dt>Días en planilla</dt>
                    <dd>{data.line.days}</dd>
                  </div>
                </dl>
                <details className="personnel-detail">
                  <summary>
                    Ver bonos, beneficios y descuentos <ChevronDown size={15} />
                  </summary>
                  <dl className="personnel-breakdown">
                    {[
                      [
                        "Pensión y otros ajustes",
                        Math.max(
                          0,
                          data.line.grossCents -
                            data.line.netCents -
                            data.line.fifthCategoryCents -
                            data.line.otherDeductionCents,
                        ),
                      ],
                      ["Bonos y extras afectos", data.line.taxableExtraCents],
                      [
                        "Bonos e ingresos no afectos",
                        data.line.nonTaxableCents,
                      ],
                      ["Gratificación o aguinaldo", data.line.gratuityCents],
                      ["CTS registrada", data.line.ctsCents],
                      ["Vacaciones", data.line.vacationCents],
                      ["Quinta categoría", data.line.fifthCategoryCents],
                      [
                        "Otros descuentos (incluye obra)",
                        data.line.otherDeductionCents,
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{amount(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="hint">
                    Importes registrados para este periodo. La CTS y las
                    gratificaciones dependen de tu régimen y fecha de pago; un
                    importe en cero no determina que no te correspondan.
                  </p>
                </details>
              </>
            )}
            {!!data.incidents.length && (
              <div className="payroll-own-incidents">
                <h3>Incidencias de obra</h3>
                {data.incidents.map((i) => (
                  <div key={i.id}>
                    <span>
                      <strong>{i.item}</strong>
                      <small>
                        {i.workName} ·{" "}
                        {i.payrollStatus === "draft"
                          ? "Incluido en borrador"
                          : i.payrollStatus === "paid" ||
                              i.payrollStatus === "approved"
                            ? "Descuento en planilla"
                            : incidentState(i)}
                      </small>
                    </span>
                    <b>{amount(i.cents)}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
