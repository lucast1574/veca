import { useId, useState, type ReactNode } from "react";
import type { ZodType } from "zod";
import { Button, Field, Notice } from "../../../components/ui";
import { Modal } from "../../../components/Modal";
import { api } from "../../../lib/api";
import { confirmDiscard, useUnsavedChanges } from "../../../lib/unsaved";
import { accountingPath, decimal } from "../accounting-shared";

export const laborPath = accountingPath + "/labor";
export const healthLabels = {
  essalud: "EsSalud",
  eps: "EPS",
  sis: "SIS",
  special: "Régimen especial",
};
export const pensionLabels = {
  onp: "ONP",
  afp: "AFP",
  special: "Régimen especial",
};

export function saveLabor(path: string, data: unknown, method = "POST") {
  return api(laborPath + path, {
    method,
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(28_000),
  });
}

export function validate<T>(schema: ZodType<T>, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Revisa los datos del formulario.",
    );
  return parsed.data;
}

export const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
export const money = (form: FormData, name: string) =>
  decimal(field(form, name));

export function MoneyField({
  label,
  name,
  cents,
  required,
}: {
  label: string;
  name: string;
  cents?: number;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        inputMode="decimal"
        pattern="[0-9]+([.,][0-9]{1,2})?"
        placeholder="0.00"
        defaultValue={
          cents === undefined ? undefined : (cents / 100).toFixed(2)
        }
        required={required}
      />
    </Field>
  );
}

export function LaborForm({
  title,
  description,
  children,
  onSave,
  onClose,
  onSaved,
  secondary,
  label,
  wide,
  danger,
  validateForm,
}: {
  title: string;
  description?: string;
  children: ReactNode | ((changed: () => void) => ReactNode);
  onSave: (form: FormData, action: string) => Promise<unknown>;
  onClose: () => void;
  onSaved: (action: string) => void;
  label: string;
  secondary?: string;
  wide?: boolean;
  danger?: boolean;
  validateForm?: (form: FormData, action: "draft" | "primary") => boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useUnsavedChanges(dirty && !busy);
  function close() {
    if (!busy && confirmDiscard(dirty)) onClose();
  }
  return (
    <Modal
      title={title}
      description={description}
      size={wide ? "wide" : "default"}
      className="labor-modal"
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Volver
          </Button>
          {secondary && (
            <Button
              variant="ghost"
              type="submit"
              form={id}
              value="draft"
              disabled={busy}
              validateForm={
                validateForm && ((form) => validateForm(form, "draft"))
              }
            >
              {secondary}
            </Button>
          )}
          <Button
            variant={danger ? "danger" : "primary"}
            type="submit"
            form={id}
            value="primary"
            disabled={busy}
            validateForm={
              validateForm && ((form) => validateForm(form, "primary"))
            }
          >
            {busy ? "Guardando…" : label}
          </Button>
        </footer>
      }
    >
      <form
        id={id}
        className="labor-form"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const action =
            (
              (event.nativeEvent as SubmitEvent)
                .submitter as HTMLButtonElement | null
            )?.value || "primary";
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            await onSave(form, action);
            onSaved(action);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="labor-fields" disabled={busy}>
          {typeof children === "function"
            ? children(() => setDirty(true))
            : children}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
