import { useState } from "react";
import type { Lead, SessionUser } from "@veca/content";
import { Users, ArrowRight } from "lucide-react";
import { Button, Field, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { confirmDiscard } from "../../lib/unsaved";
import { api } from "../../lib/api";
import { WorkTeamDialog } from "./WorkTeamDialog";
import "./works.css";

export function WorkHandoffPanel({
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
  const [editing, setEditing] = useState(false);
  const [returning, setReturning] = useState(false);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handoff = lead.workHandoff;
  const manage = user.permissions.includes("works_manage");
  const send =
    !workView &&
    user.permissions.includes("leads") &&
    lead.stage === "coordination" &&
    (!handoff || handoff.status === "returned");
  const review =
    workView &&
    manage &&
    handoff?.status === "submitted" &&
    lead.workAssignment?.coordinatorId === user.id;
  async function decide(action: "accepted" | "returned") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/works/${lead.id}/handoff`, {
        method: "POST",
        body: JSON.stringify({ version: lead.version, action, observation }),
      });
      setReturning(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ops-card work-handoff">
      <div className="lead-detail-section-head">
        <div>
          <h2>
            <Users size={18} aria-hidden="true" /> Equipo de obra
          </h2>
          <p>
            {lead.workAssignment?.coordinatorName || "Coordinador por asignar"}
          </p>
        </div>
        {send ? (
          <Button disabled={busy} onClick={() => setEditing(true)}>
            Enviar a Operaciones <ArrowRight size={16} />
          </Button>
        ) : (
          workView &&
          manage && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Asignar equipo
            </Button>
          )
        )}
      </div>
      {!!lead.workAssignment?.participantNames.length && (
        <p>{lead.workAssignment.participantNames.join(" · ")}</p>
      )}
      {handoff && (
        <p className="hint">
          {handoff.status === "submitted"
            ? "Pendiente de revisión del coordinador"
            : handoff.status === "accepted"
              ? "Entrega aceptada por Operaciones"
              : "Devuelta a Comercial"}
        </p>
      )}
      {handoff?.observation && <p>{handoff.observation}</p>}
      {error && !returning && <Notice error>{error}</Notice>}
      {review && (
        <div className="work-handoff-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError("");
              setReturning(true);
            }}
          >
            Devolver a Comercial
          </Button>
          <Button disabled={busy} onClick={() => void decide("accepted")}>
            {busy ? "Guardando…" : "Aceptar entrega"}
          </Button>
        </div>
      )}
      {editing && (
        <WorkTeamDialog
          lead={lead}
          handoff={send}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
      {returning && (
        <Modal
          title="Devolver a Comercial"
          description={lead.name}
          busy={busy}
          onClose={() => {
            if (confirmDiscard(Boolean(observation.trim()), busy))
              setReturning(false);
          }}
        >
          <form
            className="work-team-form"
            onSubmit={(e) => {
              e.preventDefault();
              void decide("returned");
            }}
          >
            <Field label="Qué falta completar">
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                disabled={busy}
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
              />
            </Field>
            {error && <Notice error>{error}</Notice>}
            <Button disabled={busy} type="submit">
              {busy ? "Guardando…" : "Confirmar devolución"}
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}
