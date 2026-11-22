import { useState, type FormEvent, type ReactNode } from "react";
import { Select } from "@veca/ui/src/Select";
import type { Material } from "@veca/content";
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
    label: `${row.sku} · ${row.name}`,
  }));
export const purchaseStatus = {
  requested: "Solicitada",
  open: "Por recibir",
  partial: "Recepción parcial",
  received: "Recibida",
  cancelled: "Cancelada",
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
}: {
  title: string;
  action: string;
  onClose: () => void;
  save: (form: FormData) => Promise<void>;
  children: ReactNode;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await save(values);
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
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <fieldset className="warehouse-fields" disabled={busy}>
          {children}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <footer className="ve-modal-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button disabled={busy}>{busy ? "Guardando…" : action}</Button>
        </footer>
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
}: {
  label: string;
  name?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <Select
        label={label}
        name={name}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
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
