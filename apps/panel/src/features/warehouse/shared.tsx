import { ChevronLeft } from "lucide-react";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Select } from "@veca/ui/src/Select";
import { formatMaterialDimensions, type Material } from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { api } from "../../lib/api";
import {
  accountingPost,
  useAccountingQuery,
} from "../accounting/accounting-shared";

export const warehousePath = "/admin/warehouse";
export type WorkOption = { id: string; name: string; stage: string };
export const materialsPath = "/admin/crm/materials";
export const postWarehouse = accountingPost;
export const useWarehouseMaterials = () =>
  useAccountingQuery<Material[]>(materialsPath);
export const useWarehouseWorks = () =>
  useAccountingQuery<WorkOption[]>(warehousePath + "/works");
export const materialOptions = (materials: Material[]) =>
  materials.map((row) => ({
    value: row.id,
    label: `${row.sku} · ${row.name}${row.dimensions ? ` · ${formatMaterialDimensions(row.dimensions)}` : ""}`,
  }));
export const purchaseStatus = {
  requested: "Por completar en Contabilidad",
  open: "Por recibir",
  partial: "Recepción parcial",
  received: "Recibido",
  cancelled: "Cancelado",
};
export const conditionLabels = {
  good: "Operativo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
};

export const stringField = (form: FormData, name: string) =>
  String(form.get(name) || "").trim();
export const numberField = (form: FormData, name: string) =>
  Number(stringField(form, name));
export const putWarehouse = <T,>(path: string, data: unknown) =>
  api<T>(path, {
    method: "PUT",
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(25_000),
  });

export function WarehouseForm({
  title,
  action,
  onClose,
  save,
  children,
  wide = false,
  canSubmit = true,
  validateForm,
  hasChanges = false,
}: {
  title: string;
  action: string;
  onClose: () => void;
  save: (form: FormData) => Promise<void>;
  children: ReactNode;
  wide?: boolean;
  canSubmit?: boolean;
  validateForm?: (form: FormData) => boolean;
  hasChanges?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const formId = useId();
  const [dirty, setDirty] = useState(false);
  const baseline = useRef("");
  const snapshot = () =>
    JSON.stringify(
      Array.from(
        form.current?.querySelectorAll<HTMLElement>(
          "input, textarea, [role=combobox]",
        ) || [],
      ).map((field) =>
        field instanceof HTMLInputElement
          ? [field.value, field.checked]
          : field instanceof HTMLTextAreaElement
            ? field.value
            : field.textContent,
      ),
    );
  useEffect(() => {
    baseline.current = snapshot();
  }, []);
  const clearGuard = useUnsavedChanges(dirty || hasChanges, busy);
  function close() {
    if (confirmDiscard(dirty || hasChanges, busy)) onClose();
  }
  function track() {
    queueMicrotask(() => {
      if (form.current && snapshot() !== baseline.current) setDirty(true);
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSubmit) return;
    const values = new FormData(event.currentTarget);
    if (validateForm && !validateForm(values)) return;
    setBusy(true);
    setError("");
    try {
      await save(values);
      clearGuard();
      setDirty(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      size={wide ? "wide" : undefined}
      onClose={close}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !canSubmit}
            validateForm={validateForm}
          >
            {busy ? "Guardando…" : action}
          </Button>
        </footer>
      }
    >
      <form
        id={formId}
        ref={form}
        onSubmit={submit}
        onChange={() => setDirty(true)}
        onClick={track}
        onKeyUp={track}
      >
        <fieldset className="warehouse-fields" disabled={busy}>
          {children}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}

export function WarehouseSelect({
  label,
  name,
  value,
  options,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  name?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
        floating
        label={label}
        name={name}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
    </Field>
  );
}

export function PickWork({
  works,
  value,
  onChange,
  allowGeneral = false,
}: {
  works: WorkOption[];
  value: string;
  onChange: (value: string) => void;
  allowGeneral?: boolean;
}) {
  return (
    <WarehouseSelect
      label="Obra"
      value={value}
      onChange={onChange}
      options={[
        ...(allowGeneral ? [{ value: "", label: "Almacén general" }] : []),
        ...works.map((row) => ({ value: row.id, label: row.name })),
      ]}
    />
  );
}

export function WarehouseBack({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className="warehouse-link">
      <ChevronLeft size={17} aria-hidden="true" />
      {children}
    </a>
  );
}
