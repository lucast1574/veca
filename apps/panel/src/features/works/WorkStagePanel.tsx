import { useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  RotateCcw,
  Send,
} from "lucide-react";
import {
  LEAD_STAGES,
  nextWorkStage,
  type Lead,
  type SessionUser,
  type WorkCloseout,
} from "@veca/content";
import { Button, Field } from "../../components/ui";
import { api } from "../../lib/api";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { WarehouseForm, stringField } from "../warehouse/shared";
import { WorkCloseoutChecks } from "./WorkCloseout";
import { useLiveRefresh } from "../operations/shared";
import "./work-stage.css";

const stageName = (stage: string) =>
  LEAD_STAGES.find((item) => item.id === stage)?.name;

export function WorkStagePanel({
  lead,
  user,
  workView,
  onSaved,
}: {
  lead: Lead;
  user: SessionUser;
  workView: boolean;
  onSaved: () => void;
}) {
  const [dialog, setDialog] = useState<"request" | "approved" | "returned">();
  const request = lead.stageRequest;
  const next = nextWorkStage(lead.stage);
  const unfinished =
    next === "completed" &&
    lead.workTasks?.some((task) => task.status !== "done");
  const pending = request?.status === "pending";
  const returned =
    request?.status === "returned" && request.from === lead.stage;
  const team = lead.workAssignment;
  const coordinator =
    team?.coordinatorId === user.id &&
    user.permissions.includes("works_manage");
  const member =
    team && [team.coordinatorId, ...team.participantIds].includes(user.id);
  const canRequest =
    workView &&
    member &&
    !coordinator &&
    user.permissions.some(
      (p) => p === "works_report" || p === "works_manage",
    ) &&
    next &&
    !pending &&
    (!lead.workHandoff || lead.workHandoff.status === "accepted");
  if (!request && (!workView || !member || coordinator || !next)) return null;
  if (!next && request?.status === "returned") return null;
  if (!request && lead.workHandoff && lead.workHandoff.status !== "accepted")
    return null;
  const done = () => {
    setDialog(undefined);
    onSaved();
  };
  const open = dialog && (
    <StageDialog
      key={dialog}
      mode={dialog}
      lead={lead}
      close={() => setDialog(undefined)}
      done={done}
    />
  );
  return (
    <section
      className="ops-card work-stage-panel"
      aria-label="Avance de la obra"
    >
      <header>
        <div>
          <p className="work-stage-label">AVANCE DE LA OBRA</p>
          <h2>
            {stageName(request && pending ? request.from : lead.stage)}
            {next && (
              <>
                <ArrowRight size={18} aria-hidden="true" />
                <span>{stageName(next)}</span>
              </>
            )}
          </h2>
        </div>
        {request &&
          (pending || returned || (!next && request.status === "approved")) && (
            <span
              className="work-stage-status"
              data-state={request.status}
              role="status"
            >
              {pending ? (
                <Clock3 size={16} />
              ) : returned ? (
                <RotateCcw size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {pending
                ? "Por aprobar"
                : returned
                  ? "Devuelta para corregir"
                  : "Avance aprobado"}
            </span>
          )}
      </header>
      {request && (pending || returned) ? (
        <>
          <p className="work-stage-note">{request.note}</p>
          <p className="work-stage-meta">
            {request.requestedName} · Solicitud del{" "}
            {new Date(request.requestedAt).toLocaleDateString("es-PE", {
              timeZone: "America/Lima",
              day: "2-digit",
              month: "short",
            })}
          </p>
          {returned && (
            <div className="work-stage-observation">
              <strong>Qué falta completar</strong>
              <p>{request.observation}</p>
            </div>
          )}
        </>
      ) : null}
      {pending ? (
        <p className="work-stage-help">
          {coordinator
            ? "Revisa el trabajo antes de aprobar. Leads y Obras avanzarán juntos."
            : `La etapa se actualizará cuando ${team?.coordinatorName || "el coordinador"} apruebe la solicitud.`}
        </p>
      ) : (
        next && (
          <p className="work-stage-help">
            Solicita el avance a {team?.coordinatorName || "tu coordinador"}. La
            ficha de Leads se actualizará al aprobar.
          </p>
        )
      )}
      <div className="work-stage-actions">
        {!workView && user.permissions.includes("works") && (
          <a className="btn btn-ghost" href={`#works/${lead.id}`}>
            Abrir en Obras <ArrowRight size={16} />
          </a>
        )}
        {workView && coordinator && pending && (
          <>
            <Button variant="ghost" onClick={() => setDialog("returned")}>
              <RotateCcw size={16} /> Devolver
            </Button>
            <Button onClick={() => setDialog("approved")}>
              Revisar solicitud <ArrowRight size={16} />
            </Button>
          </>
        )}
        {canRequest && (
          <Button disabled={!!unfinished} onClick={() => setDialog("request")}>
            <Send size={16} />
            {returned ? "Volver a solicitar" : "Solicitar avance"}
          </Button>
        )}
      </div>
      {canRequest && unfinished && (
        <p className="work-stage-help">
          Completa los pendientes de trabajo antes de solicitar el cierre.{" "}
          <a className="warehouse-link" href={`#works/${lead.id}/tasks`}>
            Revisar pendientes
          </a>
        </p>
      )}
      {open}
    </section>
  );
}

function StageDialog({
  mode,
  lead: currentLead,
  close,
  done,
}: {
  mode: "request" | "approved" | "returned";
  lead: Lead;
  close: () => void;
  done: () => void;
}) {
  const lead = useRef(currentLead).current;
  const version = useRef(lead.version);
  const request = lead.stageRequest;
  const to = mode === "request" ? nextWorkStage(lead.stage) : request?.to;
  const closeout = useAccountingQuery<WorkCloseout>(
    mode === "approved" && to === "completed"
      ? `/admin/work-control/${lead.id}/closeout`
      : "",
  );
  useLiveRefresh(
    closeout.refresh,
    false,
    mode === "approved" && to === "completed",
    "/admin/works/events",
  );
  return (
    <WarehouseForm
      title={
        mode === "request"
          ? "Solicitar avance de obra"
          : mode === "approved"
            ? "Revisar avance de obra"
            : "Devolver solicitud de avance"
      }
      action={
        mode === "request"
          ? "Enviar al coordinador"
          : mode === "approved"
            ? "Aprobar avance"
            : "Devolver al equipo"
      }
      canSubmit={
        mode !== "approved" || to !== "completed" || !!closeout.data?.ready
      }
      onClose={close}
      save={async (form) => {
        const path = `/admin/works/${lead.id}/stage-requests`;
        await api(
          mode === "request" ? path : `${path}/${request!.id}/decision`,
          {
            method: "POST",
            body: JSON.stringify(
              mode === "request"
                ? { version: version.current, note: stringField(form, "note") }
                : {
                    version: version.current,
                    action: mode,
                    observation: stringField(form, "observation"),
                  },
            ),
          },
        );
        done();
      }}
    >
      <div className="work-stage-route">
        <span>{stageName(lead.stage)}</span>
        <ArrowRight size={18} aria-hidden="true" />
        <strong>{stageName(to || "")}</strong>
      </div>
      {mode === "request" ? (
        <>
          <p className="hint">
            {lead.workAssignment?.coordinatorName} recibirá la solicitud en su
            bandeja de Inicio. La etapa actual se mantiene hasta su aprobación.
          </p>
          <Field label="Trabajo realizado y motivo del avance">
            <textarea
              name="note"
              required
              minLength={10}
              maxLength={3000}
              rows={4}
              defaultValue={request?.status === "returned" ? request.note : ""}
            />
          </Field>
        </>
      ) : mode === "returned" ? (
        <Field label="Qué debe completar el equipo">
          <textarea
            name="observation"
            required
            minLength={5}
            maxLength={3000}
            rows={4}
          />
        </Field>
      ) : (
        <>
          <p className="work-stage-note">{request?.note}</p>
          {to === "completed" && (
            <QueryState {...closeout}>
              {closeout.data && (
                <WorkCloseoutChecks id={lead.id} data={closeout.data} />
              )}
            </QueryState>
          )}
          <Field
            label={
              to === "completed"
                ? "Resultado y cierre de la obra"
                : "Observación (opcional)"
            }
          >
            <textarea
              name="observation"
              rows={3}
              maxLength={3000}
              required={to === "completed"}
              minLength={to === "completed" ? 10 : undefined}
              defaultValue={to === "completed" ? request?.note : ""}
            />
          </Field>
          <p className="hint">
            Al aprobar, la etapa se actualizará en Leads y Obras y quedará
            registrada en el historial.
          </p>
        </>
      )}
    </WarehouseForm>
  );
}
