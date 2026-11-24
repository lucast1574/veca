import { useEffect, useId, useState, type FormEvent } from "react";
import type { Lead, WorkPerson } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { confirmDiscard } from "../../lib/unsaved";

export function WorkTeamDialog({
  lead,
  handoff,
  onClose,
  onSaved,
}: {
  lead: Lead;
  handoff: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [people, setPeople] = useState<WorkPerson[]>();
  const [coordinatorId, setCoordinator] = useState(
    lead.workAssignment?.coordinatorId || "",
  );
  const [participantIds, setParticipants] = useState(
    lead.workAssignment?.participantIds || [],
  );
  const [address, setAddress] = useState(lead.address);
  const [workPlan, setPlan] = useState(lead.workPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<WorkPerson[]>(
      handoff ? "/admin/crm/work-people" : "/admin/works/people",
      { signal: controller.signal },
    )
      .then(setPeople)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [handoff]);
  const dirty =
    coordinatorId !== (lead.workAssignment?.coordinatorId || "") ||
    JSON.stringify(participantIds) !==
      JSON.stringify(lead.workAssignment?.participantIds || []) ||
    address !== lead.address ||
    workPlan !== lead.workPlan;
  function close() {
    if (confirmDiscard(dirty, busy)) onClose();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !people) return;
    setError("");
    if (
      !people.some(
        (person) => person.id === coordinatorId && person.canCoordinate,
      )
    ) {
      setError("Selecciona un coordinador activo.");
      return;
    }
    setBusy(true);
    try {
      const team = {
        coordinatorId,
        participantIds: participantIds.filter((id) => id !== coordinatorId),
      };
      await api(
        handoff
          ? `/admin/crm/leads/${lead.id}/handoff`
          : `/admin/works/${lead.id}/team`,
        {
          method: handoff ? "POST" : "PUT",
          body: JSON.stringify(
            handoff
              ? { version: lead.version, ...team, address, workPlan }
              : { version: lead.version, team },
          ),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={handoff ? "Enviar a Operaciones" : "Asignar equipo"}
      description={lead.name}
      onClose={close}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button
            form={formId}
            type="submit"
            disabled={busy || !people || !coordinatorId}
          >
            {busy
              ? "Guardando…"
              : handoff
                ? "Enviar entrega"
                : "Guardar equipo"}
          </Button>
        </footer>
      }
    >
      <form id={formId} onSubmit={save} className="work-team-form">
        {error && <Notice error>{error}</Notice>}
        {!people && !error && <p role="status">Cargando equipo…</p>}
        <Field label="Coordinador de obra" htmlFor={formId + "-coordinator"}>
          <Select
            id={formId + "-coordinator"}
            label="Coordinador de obra"
            floating
            value={coordinatorId}
            disabled={busy || !people}
            options={(people || [])
              .filter((person) => person.canCoordinate)
              .map((person) => ({ value: person.id, label: person.name }))}
            onChange={(id) => {
              setCoordinator(id);
              setParticipants((old) => old.filter((person) => person !== id));
            }}
          />
        </Field>
        <fieldset className="photo-tag-picker" disabled={busy || !people}>
          <legend>Trabajadores asignados</legend>
          <div>
            {people
              ?.filter((person) => person.id !== coordinatorId)
              .map((person) => (
                <button
                  type="button"
                  key={person.id}
                  aria-pressed={participantIds.includes(person.id)}
                  onClick={() =>
                    setParticipants((old) =>
                      old.includes(person.id)
                        ? old.filter((id) => id !== person.id)
                        : [...old, person.id],
                    )
                  }
                >
                  {person.name}
                </button>
              ))}
          </div>
          {!!people &&
            participantIds
              .filter((id) => !people.some((person) => person.id === id))
              .map((id) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed="true"
                  onClick={() =>
                    setParticipants((old) =>
                      old.filter((value) => value !== id),
                    )
                  }
                >
                  {lead.workAssignment?.participantNames[
                    lead.workAssignment.participantIds.indexOf(id)
                  ] || "Persona no disponible"}{" "}
                  · Quitar del equipo
                </button>
              ))}
          {people && !people.length && (
            <p className="hint">
              Habilita las cuentas operativas desde Equipo.
            </p>
          )}
        </fieldset>
        {handoff && (
          <>
            <Field label="Dirección de la obra">
              <input
                required
                minLength={5}
                maxLength={500}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Alcance acordado">
              <textarea
                required
                minLength={10}
                maxLength={6000}
                rows={4}
                value={workPlan}
                onChange={(e) => setPlan(e.target.value)}
                disabled={busy}
              />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
