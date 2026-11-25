import { MarginProjection } from "./MarginProjection";
import { Button } from "../../components/ui";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  Package,
  Wallet,
} from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import type { AccountingMargin, AccountingWork } from "@veca/content";
import {
  accountingPath,
  amount,
  QueryState,
  Refresh,
  useAccountingQuery,
} from "./accounting-shared";
import { CostDistribution, MarginBridge } from "./margin-charts";
import {
  marginBreakdown,
  percentLabel,
  percentage,
  progress,
} from "./margin-model";
import "./margin.css";

function MarginReport({ report }: { report: AccountingMargin }) {
  const available = report.labor.available;
  const provisional =
    report.pendingValuation || Boolean(report.manualMaterialsToReview);
  const result = report.sales - report.costs;
  const remaining = report.budgetCents - report.costs;
  const invoiced = report.paid + report.balance;
  const rows = marginBreakdown(report);
  return (
    <div className="margin-report">
      <section
        className={`margin-result${available && result < 0 ? " is-loss" : ""}`}
        aria-labelledby="margin-work-name"
      >
        <div className="margin-result-copy">
          <span className="margin-eyebrow">Resultado de la obra</span>
          <h3 id="margin-work-name">{report.workName}</h3>
          <span className="margin-state">
            {!available
              ? "Costos por completar"
              : provisional
                ? "Resultado provisional"
                : "Según lo registrado"}
          </span>
          <div className="margin-main-value">
            <span>
              {!available
                ? "Ganancia por confirmar"
                : result < 0
                  ? "Pérdida registrada"
                  : "Ganancia registrada"}
            </span>
            <strong>
              {available ? amount(Math.abs(result)) : "Por confirmar"}
            </strong>
          </div>
          {available && (
            <p className="margin-ratio">
              <span>{percentLabel(percentage(result, report.sales))}</span>
              {report.sales > 0 && " de la venta neta"}
            </p>
          )}
          <p className="margin-explanation">
            Venta neta menos costos asignados. Importes sin IGV, acumulados de
            esta obra.
          </p>
        </div>
        <div className="margin-result-chart">
          {available ? (
            <MarginBridge sales={report.sales} costs={report.costs} />
          ) : (
            <div className="margin-incomplete">
              <CircleAlert size={28} />
              <strong>Falta confirmar los costos de personal</strong>
              <p>
                Mostramos los gastos disponibles. La ganancia se calculará
                cuando se recupere la consulta de planilla y honorarios.
              </p>
            </div>
          )}
          <dl className="margin-totals">
            <div>
              <dt>Venta neta</dt>
              <dd>{amount(report.sales)}</dd>
            </div>
            <div>
              <dt>{available ? "Costos asignados" : "Costos disponibles"}</dt>
              <dd>{amount(report.costs)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {(provisional || !available) && (
        <aside className="margin-review" role="status">
          <CircleAlert size={19} />
          <div>
            <strong>Hay costos por revisar</strong>
            {!available && (
              <p>No pudimos cargar los costos de personal asignados.</p>
            )}
            {report.pendingValuation && (
              <p>
                Hay materiales consumidos sin costo de origen. El resultado
                puede cambiar al valorizarlos.
              </p>
            )}
            {Boolean(report.manualMaterialsToReview) && (
              <p>
                {amount(report.manualMaterialsToReview)} en consumos manuales
                requieren revisión por posible duplicidad; están excluidos del
                total.
              </p>
            )}
          </div>
        </aside>
      )}

      <section className="margin-card" aria-labelledby="margin-cost-heading">
        <header className="margin-card-heading">
          <div>
            <span className="margin-eyebrow">En qué se gastó</span>
            <h3 id="margin-cost-heading">Gastos de la obra</h3>
            <p>
              Costos asignados, agrupados por su origen
              {!available ? ". Personal pendiente de confirmar." : "."}
            </p>
          </div>
          <Package size={23} aria-hidden="true" />
        </header>
        {rows.length ? (
          <CostDistribution rows={rows} total={report.costs} />
        ) : (
          <div className="margin-no-costs">
            <Package size={28} />
            <strong>Aún no hay costos asignados</strong>
            <p>
              Los consumos de almacén, gastos y costos de personal aparecerán
              aquí cuando se vinculen a la obra.
            </p>
          </div>
        )}
        <footer className="margin-card-links">
          <a href="#accounting/gastos">
            Revisar compras y gastos <ArrowUpRight size={15} />
          </a>
          <a href="#accounting/personal">
            Revisar costos de personal <ArrowUpRight size={15} />
          </a>
        </footer>
      </section>

      <div className="margin-finance-grid">
        <section
          className="margin-card"
          aria-labelledby="margin-budget-heading"
        >
          <header className="margin-card-heading">
            <div>
              <span className="margin-eyebrow">Control de costos</span>
              <h3 id="margin-budget-heading">Presupuesto</h3>
            </div>
            <Wallet size={22} aria-hidden="true" />
          </header>
          {report.budgetCents > 0 ? (
            <>
              <div className="margin-finance-value">
                <span>
                  {remaining < 0
                    ? "Por encima del presupuesto"
                    : "Disponible según costos registrados"}
                </span>
                <strong className={remaining < 0 ? "margin-loss-text" : ""}>
                  {amount(Math.abs(remaining))}
                </strong>
              </div>
              <div
                className={`margin-meter${remaining < 0 ? " is-over" : ""}`}
                role="img"
                aria-label={`${percentLabel(percentage(report.costs, report.budgetCents))} del presupuesto utilizado`}
              >
                <span
                  style={{
                    width: `${progress(report.costs, report.budgetCents)}%`,
                  }}
                />
              </div>
              <dl className="margin-pairs">
                <div>
                  <dt>Presupuesto de costos</dt>
                  <dd>{amount(report.budgetCents)}</dd>
                </div>
                <div>
                  <dt>{available ? "Costo registrado" : "Costo disponible"}</dt>
                  <dd>{amount(report.costs)}</dd>
                </div>
              </dl>
              <p className="margin-footnote">
                {report.quotation && (
                  <>Según cotización {report.quotation.reference}. </>
                )}
                {percentLabel(percentage(report.costs, report.budgetCents))}{" "}
                utilizado.
                {(!available || provisional) &&
                  " Los pendientes pueden reducir el disponible."}
              </p>
            </>
          ) : (
            <p className="margin-empty-budget">
              La obra aún no tiene un presupuesto de costos. Los gastos
              registrados siguen visibles arriba.
            </p>
          )}
        </section>
        <section
          className="margin-card"
          aria-labelledby="margin-collection-heading"
        >
          <header className="margin-card-heading">
            <div>
              <span className="margin-eyebrow">Entrada de dinero</span>
              <h3 id="margin-collection-heading">Cobros de la obra</h3>
            </div>
            <ArrowDownLeft size={22} aria-hidden="true" />
          </header>
          <div className="margin-finance-value">
            <span>Pendiente de cobro</span>
            <strong>{amount(report.balance)}</strong>
          </div>
          <div
            className="margin-meter is-collected"
            role="img"
            aria-label={`${percentLabel(percentage(report.paid, invoiced))} de la facturación cobrada`}
          >
            <span style={{ width: `${progress(report.paid, invoiced)}%` }} />
          </div>
          <dl className="margin-pairs">
            <div>
              <dt>Cobrado</dt>
              <dd>{amount(report.paid)}</dd>
            </div>
            <div>
              <dt>Total facturado con IGV</dt>
              <dd>{amount(invoiced)}</dd>
            </div>
          </dl>
          <p className="margin-footnote">
            {invoiced > 0
              ? `${percentLabel(percentage(report.paid, invoiced))} cobrado. Incluye IGV; la ganancia se calcula sobre la venta neta.`
              : "Aún no hay facturas emitidas para esta obra."}
          </p>
        </section>
      </div>
    </div>
  );
}

export function Margin() {
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("summary");
  const work = selected || works.data?.[0]?.id || "";
  const query = useAccountingQuery<AccountingMargin>(
    work ? accountingPath + "/margin/" + work : "",
  );
  return (
    <section className="margin-workspace">
      <header className="accounting-section-head">
        <div>
          <h2>Margen por obra</h2>
          <p className="margin-subtitle">
            Ganancia, gastos y cobros en una sola vista.
          </p>
        </div>
        <div className="accounting-tools">
          <Select
            label="Obra para consultar"
            value={work}
            placeholder="Selecciona una obra"
            options={(works.data || []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={setSelected}
          />
          <Refresh
            loading={work ? query.loading : works.loading}
            onClick={work ? query.refresh : works.refresh}
          />
        </div>
      </header>
      <nav
        className="accounting-tabs margin-tabs"
        aria-label="Vista del margen"
      >
        <Button
          variant="ghost"
          aria-current={tab === "summary" ? "page" : undefined}
          onClick={() => setTab("summary")}
        >
          Resumen
        </Button>
        <Button
          variant="ghost"
          aria-current={tab === "projection" ? "page" : undefined}
          onClick={() => setTab("projection")}
        >
          Proyección
        </Button>
      </nav>
      <QueryState
        {...works}
        empty={!work ? "Aún no hay obras para consultar." : undefined}
      >
        {work && (
          <QueryState {...query}>
            {query.data &&
              (tab === "projection" ? (
                <MarginProjection
                  key={`${work}:${query.data.quotation?.attachmentId}:${query.data.costs}`}
                  report={query.data}
                />
              ) : (
                <MarginReport report={query.data} />
              ))}
          </QueryState>
        )}
      </QueryState>
    </section>
  );
}
