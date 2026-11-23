import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { useId, useRef, useState, type FormEvent } from "react";
import { publicLeadSchema, REQUEST_TYPES } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { post } from "../../lib/api";

const contactFields = [
  ["name", "Nombre y apellido", "text", "name"],
  ["phone", "Teléfono", "tel", "tel"],
  ["email", "Correo", "email", "email"],
  ["district", "Distrito", "text", "address-level3"],
];

export function CreateLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const id = useId();
  const submissionId = useRef<string | null>(null);
  const [requestType, setRequestType] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const clearGuard = useUnsavedChanges(dirty, busy);
  function close() {
    if (confirmDiscard(dirty, busy)) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    submissionId.current ??= crypto.randomUUID();
    const input = publicLeadSchema.safeParse({
      ...fields,
      requestType,
      submissionId: submissionId.current,
      website: "",
    });
    if (!input.success) {
      setError(input.error.issues[0].message);
      const field = event.currentTarget.elements.namedItem(
        String(input.error.issues[0].path[0]),
      );
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { reference } = await post<{ reference: string }>(
        "/admin/crm/leads",
        input.data,
      );
      clearGuard();
      onCreated(reference);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="ops-create-lead"
      title="Registrar lead"
      description="Indica un teléfono o correo. Puedes completar el trabajo y el distrito después."
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={id} disabled={busy}>
            {busy ? "Guardando…" : "Guardar lead"}
          </Button>
        </footer>
      }
    >
      <form id={id} onSubmit={submit} onChange={() => setDirty(true)}>
        <fieldset className="ops-form-grid" disabled={busy}>
          {contactFields.map(([name, label, type, autoComplete]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                type={type}
                autoComplete={autoComplete}
                required={name === "name"}
                maxLength={
                  name === "name"
                    ? 100
                    : name === "phone"
                      ? 30
                      : name === "district"
                        ? 120
                        : 180
                }
              />
            </Field>
          ))}
          <Field label="Tipo de trabajo" htmlFor={id + "-type"}>
            <Select
              id={id + "-type"}
              label="Tipo de trabajo"
              value={requestType}
              options={[
                { value: "", label: "Por definir" },
                ...REQUEST_TYPES.map((type) => ({
                  value: type.id,
                  label: type.name,
                })),
              ]}
              placeholder="Por definir"
              onChange={(value) => {
                setRequestType(value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Idea o necesidad">
            <textarea name="idea" maxLength={4000} rows={3} />
          </Field>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
