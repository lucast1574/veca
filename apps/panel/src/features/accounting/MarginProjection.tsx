import { useState } from "react";
import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
import type { AccountingMargin } from "@veca/content";
import { Button, Field } from "../../components/ui";
import { WarehouseForm } from "../warehouse/shared";
import { amount } from "./accounting-shared";
import { MarginBridge } from "./margin-charts";
import { percentage, percentLabel, progress } from "./margin-model";

export function MarginProjection({ report }: { report: AccountingMargin }) {
  const [editing, setEditing] = useState(false);
  const [scenario, setScenario] = useState<number>();
  const quote = report.quotation;
  if (!quote)
    return (
      <section className="margin-card margin-no-costs">
        <h3>Falta la cotización de esta obra</h3>
        <p>
          Adjunta el documento y sus importes en el Resumen de la obra para ver
          el presupuesto y proyectar su resultado.
        </p>
        <a className="warehouse-link" href={`#works/${report.workId}`}>
          Abrir obra <ArrowUpRight size={15} />
        </a>
      </section>
    );
  const baseline = Math.max(quote.costBudgetCents, report.costs);
  const estimate = scenario ?? baseline;
  const profit = quote.salesNetCents - estimate;
  return (
    <div className="margin-report">
      <section className={`margin-result${profit < 0 ? " is-loss" : ""}`}>
        <div className="margin-result-copy">
          <span className="margin-eyebrow">
            {scenario === undefined
              ? report.costs > quote.costBudgetCents
                ? "Proyección según costos registrados"
                : "Proyección según presupuesto"
              : "Simulación de costos"}
          </span>
          <h3>{report.workName}</h3>
          <span className="margin-state">Cotización {quote.reference}</span>
          <div className="margin-main-value">
            <span>{profit < 0 ? "Pérdida prevista" : "Ganancia prevista"}</span>
            <strong>{amount(Math.abs(profit))}</strong>
          </div>
          <p className="margin-ratio">
            <span>{percentLabel(percentage(profit, quote.salesNetCents))}</span>{" "}
            de la venta cotizada sin IGV
          </p>
          <p className="margin-explanation">
            Venta cotizada menos costo final estimado. Es una previsión; el
            resultado registrado y los cobros se consultan en Resumen.
          </p>
        </div>
        <div className="margin-result-chart">
          <MarginBridge
            projected
            sales={quote.salesNetCents}
            costs={estimate}
          />
          <dl className="margin-totals">
            <div>
              <dt>Venta cotizada sin IGV</dt>
              <dd>{amount(quote.salesNetCents)}</dd>
            </div>
            <div>
              <dt>Costo final estimado</dt>
              <dd>{amount(estimate)}</dd>
            </div>
          </dl>
        </div>
      </section>
      {(!report.labor.available ||
        report.pendingValuation ||
        report.manualMaterialsToReview > 0) && (
        <aside className="margin-review">
          <div>
            <strong>La proyección puede cambiar</strong>
            <p>
              Hay costos de personal o materiales por completar o revisar. Usa
              Resumen para ver los pendientes.
            </p>
          </div>
        </aside>
      )}
      <section className="margin-card">
        <header className="margin-card-heading">
          <div>
            <span className="margin-eyebrow">
              Presupuesto frente a lo registrado
            </span>
            <h3>Avance económico</h3>
            <p>
              Importes acumulados sin IGV. Estos porcentajes no representan el
              avance físico.
            </p>
          </div>
        </header>
        <div className="projection-comparisons">
          {[
            {
              label: "Costos registrados",
              value: report.costs,
              total: quote.costBudgetCents,
              base: "Presupuesto de costos",
            },
            {
              label: "Venta facturada",
              value: report.sales,
              total: quote.salesNetCents,
              base: "Venta cotizada",
            },
          ].map((row) => (
            <div key={row.label}>
              <dl className="margin-pairs">
                <div>
                  <dt>{row.label}</dt>
                  <dd>{amount(row.value)}</dd>
                </div>
                <div>
                  <dt>{row.base}</dt>
                  <dd>{amount(row.total)}</dd>
                </div>
              </dl>
              <div
                className={`margin-meter${row.value > row.total ? " is-over" : ""}`}
                role="img"
                aria-label={`${row.label}: ${amount(row.value)} de ${amount(row.total)}`}
              >
                <span style={{ width: `${progress(row.value, row.total)}%` }} />
              </div>
              <p className="margin-footnote">
                {percentLabel(percentage(row.value, row.total))}{" "}
                {row.label === "Venta facturada" ? "facturado" : "utilizado"}
              </p>
            </div>
          ))}
        </div>
      </section>
      <div className="margin-finance-grid">
        <section className="margin-card">
          <header className="margin-card-heading">
            <div>
              <span className="margin-eyebrow">Anticipar el cierre</span>
              <h3>Escenario de costos</h3>
            </div>
          </header>
          <dl className="margin-pairs">
            <div>
              <dt>Presupuesto cotizado</dt>
              <dd>{amount(quote.costBudgetCents)}</dd>
            </div>
            <div>
              <dt>Por gastar según escenario</dt>
              <dd>{amount(Math.max(0, estimate - report.costs))}</dd>
            </div>
          </dl>
          <p className="margin-footnote">
            El costo final parte del presupuesto y nunca baja de los costos ya
            registrados. Simular no modifica la cotización ni registra gastos.
          </p>
          <div className="accounting-tools">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              <SlidersHorizontal size={15} />
              Simular escenario
            </Button>
            {scenario !== undefined && (
              <Button variant="ghost" onClick={() => setScenario(undefined)}>
                Restablecer
              </Button>
            )}
          </div>
        </section>
        <section className="margin-card">
          <header className="margin-card-heading">
            <div>
              <span className="margin-eyebrow">
                Condiciones de la cotización
              </span>
              <h3>Plazo y pagos</h3>
            </div>
          </header>
          <dl className="margin-pairs">
            <div>
              <dt>Vigencia</dt>
              <dd>
                {quote.date.split("-").reverse().join("/")} al{" "}
                {quote.validUntil.split("-").reverse().join("/")}
              </dd>
            </div>
            <div>
              <dt>Adelanto acordado con IGV</dt>
              <dd>{amount(quote.advanceCents)}</dd>
            </div>
            <div>
              <dt>Plazo</dt>
              <dd>
                {quote.durationDays} días{" "}
                {quote.durationType === "working" ? "hábiles" : "calendario"}
              </dd>
            </div>
          </dl>
          <p className="margin-footnote">{quote.executionTerms}</p>
          <p className="margin-footnote">{quote.paymentTerms}</p>
          {quote.notes && <p className="margin-footnote">{quote.notes}</p>}
          <p className="margin-footnote">
            El adelanto acordado no acredita un cobro. Contabilidad debe
            registrar el pago recibido.
          </p>
        </section>
      </div>
      {editing && (
        <WarehouseForm
          title="Simular costo final de la obra"
          action="Ver proyección"
          onClose={() => setEditing(false)}
          save={async (form) => {
            const cost = Math.round(Number(form.get("cost")) * 100);
            if (
              !Number.isSafeInteger(cost) ||
              cost < Math.max(0, report.costs) ||
              cost > 999999999
            )
              throw new Error(
                "El costo final debe cubrir los costos ya registrados.",
              );
            setScenario(cost);
            setEditing(false);
          }}
        >
          <Field
            label="Costo final estimado sin IGV"
            hint={`Costos registrados: ${amount(report.costs)}. Incluye lo ya gastado y lo que falta gastar.`}
          >
            <input
              name="cost"
              type="number"
              min={Math.max(0, report.costs) / 100}
              step="0.01"
              max="9999999.99"
              defaultValue={estimate / 100}
              required
            />
          </Field>
          <p className="hint">
            La simulación se conserva mientras consultas esta obra. No cambia el
            presupuesto.
          </p>
        </WarehouseForm>
      )}
    </div>
  );
}
