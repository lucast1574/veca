import { useId, useState } from "react";
import { LEAD_STAGES, REQUEST_TYPES, type LeadInput } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";

type Stage = LeadInput["stage"];
type TextKey =
  | "contactResult"
  | "appointment"
  | "address"
  | "workPlan"
  | "completionNote"
  | "discardReason";

const fields: {
  key: TextKey;
  label: string;
  max: number;
  from: number;
  type?: string;
}[] = [
  { key: "contactResult", label: "Resultado del contacto", max: 1000, from: 1 },
  {
    key: "appointment",
    label: "Cita de coordinación (hora de Lima)",
    max: 40,
    from: 2,
    type: "datetime-local",
  },
  {
    key: "address",
    label: "Dirección de la obra",
    max: 500,
    from: 3,
    type: "text",
  },
  { key: "workPlan", label: "Alcance de la obra", max: 6000, from: 3 },
  { key: "completionNote", label: "Resultado de la obra", max: 3000, from: 4 },
];

export function stageAction(stage: Stage) {
  if (stage === "discarded") return "Descartar lead";
  if (stage === "prelead") return "Reabrir lead";
  if (stage === "contacted") return "Registrar contacto";
  if (stage === "coordination") return "Programar coordinación";
  if (stage === "execution") return "Iniciar obra";
  return "Marcar obra realizada";
}

export function LeadStageDialog({
  stage,
  initial,
  onClose,
  onSave,
}: {
  stage: Stage;
  initial: LeadInput;
  onClose: () => void;
  onSave: (next: LeadInput) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const phase = LEAD_STAGES.findIndex((entry) => entry.id === stage);
  const relevant =
    stage === "discarded"
      ? [
          {
            key: "discardReason" as const,
            label: "Motivo de descarte",
            max: 1000,
            from: 0,
          },
        ]
      : fields.filter(
          ({ key, from }) =>
            from <= phase && (from === phase || !initial[key].trim()),
        );

  const completeFields = relevant.every(({ key }) => draft[key].trim());
  const completeWork =
    phase < 2 ||
    stage === "discarded" ||
    Boolean(
      draft.district.trim().length >= 2 &&
      draft.requestType &&
      draft.idea.trim().length >= 10,
    );
  const ready = completeFields && completeWork;

  function close() {
    if (
      !busy &&
      (draft === initial ||
        window.confirm("¿Cerrar sin guardar el cambio de etapa?"))
    )
      onClose();
  }

  return (
    <Modal
      title={stageAction(stage)}
      description={`La ficha pasará a «${LEAD_STAGES[phase].name}» en el tablero.`}
      onClose={close}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={id} disabled={busy || !ready}>
            {busy ? "Guardando…" : "Confirmar cambio"}
          </Button>
        </footer>
      }
    >
      <form
        id={id}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !ready) return;
          setBusy(true);
          setError("");
          try {
            const segment =
              draft.segment ||
              REQUEST_TYPES.find((type) => type.id === draft.requestType)
                ?.segment ||
              "";
            await onSave({ ...draft, segment, stage });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {phase >= 2 && stage !== "discarded" && (
          <>
            {!initial.district && (
              <Field label="Distrito">
                <input
                  required
                  maxLength={120}
                  value={draft.district}
                  onChange={(event) =>
                    setDraft({ ...draft, district: event.target.value })
                  }
                />
              </Field>
            )}
            {!initial.requestType && (
              <Field label="Tipo de trabajo" htmlFor={id + "-work-type"}>
                <Select
                  id={id + "-work-type"}
                  label="Tipo de trabajo"
                  value={draft.requestType}
                  options={REQUEST_TYPES.map((type) => ({
                    value: type.id,
                    label: type.name,
                  }))}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      requestType: value as LeadInput["requestType"],
                    })
                  }
                />
              </Field>
            )}
            {!initial.idea && (
              <Field label="Consulta del cliente">
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={3}
                  value={draft.idea}
                  onChange={(event) =>
                    setDraft({ ...draft, idea: event.target.value })
                  }
                />
              </Field>
            )}
          </>
        )}
        {relevant.map(({ key, label, max, type }) => {
          const props = {
            required: true,
            maxLength: max,
            value: draft[key],
            disabled: busy,
            onChange: (
              e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => setDraft((old) => ({ ...old, [key]: e.target.value })),
          };
          return (
            <Field key={key} label={label}>
              {type ? (
                <input type={type} {...props} />
              ) : (
                <textarea rows={3} {...props} />
              )}
            </Field>
          );
        })}
        {!ready && (
          <p className="hint">Completa los campos obligatorios para avanzar.</p>
        )}
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
