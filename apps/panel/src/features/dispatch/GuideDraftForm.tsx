import { useId, useState } from "react";
import type {
  Dispatch,
  DispatchInput,
  GuideWork,
  Material,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field } from "../../components/ui";
import {
  accountingPost,
  QueryState,
  recordId,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { DispatchForm, newDispatch } from "./DispatchForm";
import { guidePath } from "./shared";

type DraftProps = {
  workName: string;
  inventoryAccess: boolean;
  initial: DispatchInput;
  onClose: () => void;
  onSave: (data: DispatchInput) => Promise<void>;
};

export function GuideDraftForm({
  workName,
  inventoryAccess,
  ...props
}: DraftProps) {
  const materials = useAccountingQuery<Material[]>(
    inventoryAccess ? "/admin/crm/materials" : "",
  );
  return (
    <DispatchForm
      {...props}
      guideWorkName={workName}
      materials={materials.data ?? []}
    />
  );
}

export function NewGuide({
  inventoryAccess,
  onClose,
  onCreate,
}: {
  inventoryAccess: boolean;
  onClose: () => void;
  onCreate: (id: string) => void;
}) {
  const selectorId = useId();
  const [id] = useState(recordId);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [work, setWork] = useState<GuideWork>();
  const query = useAccountingQuery<GuideWork[]>(
    work
      ? ""
      : `${guidePath}/works?search=${encodeURIComponent(search.trim())}`,
  );
  const works = query.data ?? [];
  const selected = works.find((item) => item.id === selectedId);
  if (work)
    return (
      <GuideDraftForm
        workName={work.name}
        inventoryAccess={inventoryAccess}
        initial={newDispatch(work)}
        onClose={onClose}
        onSave={async (data) => {
          const saved = await accountingPost<Dispatch>(guidePath, {
            id,
            leadId: work.id,
            data,
          });
          onCreate(saved.id);
        }}
      />
    );
  return (
    <Modal
      title="Nueva guía"
      className="guide-work-picker"
      onClose={onClose}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!selected || query.loading}
            onClick={() => setWork(selected)}
          >
            Continuar
          </Button>
        </footer>
      }
    >
      <div className="dispatch-stack">
        <Field label="Buscar obra" hint="Busca por nombre o distrito.">
          <input
            type="search"
            maxLength={100}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedId("");
            }}
          />
        </Field>
        <QueryState
          {...query}
          empty={
            search.trim()
              ? "No encontramos obras con esa búsqueda."
              : "No hay obras en coordinación o ejecución."
          }
        >
          {works.length > 0 && (
            <Field label="Obra" htmlFor={selectorId}>
              <Select
                id={selectorId}
                label="Obra"
                value={selectedId}
                disabled={query.loading}
                options={works.map(({ id, name, district }) => ({
                  value: id,
                  label: name,
                  description: district,
                }))}
                onChange={setSelectedId}
              />
            </Field>
          )}
        </QueryState>
      </div>
    </Modal>
  );
}
