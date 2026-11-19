import { useId, useRef, useState, type FormEvent } from "react";
import { REQUEST_TYPES } from "@veca/content";
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
  const form = useRef<HTMLFormElement>(null);
  const submissionId = useRef<string | null>(null);
  const [requestType, setRequestType] = useState("repair");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (busy) return;
    const dirty =
      requestType !== "repair" ||
      (form.current &&
        Array.from(new FormData(form.current).values()).some(Boolean));
    if (!dirty || window.confirm("¿Cerrar sin guardar el lead?")) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    submissionId.current ??= crypto.randomUUID();
    setError("");
    setBusy(true);
    try {
      const { reference } = await post<{ reference: string }>(
        "/admin/crm/leads",
        {
          ...fields,
          requestType,
          submissionId: submissionId.current,
          website: "",
        },
      );
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
      description="Ingresa los datos de contacto y el trabajo que necesita."
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={id} disabled={busy}>
            {busy ? "Guardando…" : "Crear prelead"}
          </Button>
        </footer>
      }
    >
      <form id={id} ref={form} onSubmit={submit}>
        <fieldset className="ops-form-grid" disabled={busy}>
          {contactFields.map(([name, label, type, autoComplete]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                type={type}
                autoComplete={autoComplete}
                required
                maxLength={180}
              />
            </Field>
          ))}
          <Field label="Tipo de trabajo" htmlFor={id + "-type"}>
            <Select
              id={id + "-type"}
              label="Tipo de trabajo"
              value={requestType}
              options={REQUEST_TYPES.map((type) => ({
                value: type.id,
                label: type.name,
              }))}
              onChange={setRequestType}
            />
          </Field>
          <Field label="Idea o necesidad">
            <textarea
              name="idea"
              required
              minLength={10}
              maxLength={4000}
              rows={3}
            />
          </Field>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
