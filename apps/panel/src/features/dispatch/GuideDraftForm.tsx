import { useEffect, useId, useState } from "react";
import type {
  Dispatch,
  DispatchInput,
  GuideWork,
  Material,
} from "@veca/content";
import { SearchableSelect } from "@veca/ui/src/SearchableSelect";
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
  const [requested, setRequested] = useState("");
  const [selected, setSelected] = useState<GuideWork>();
  const [work, setWork] = useState<GuideWork>();
  const term = search.trim();
  useEffect(() => {
    const timer = setTimeout(() => setRequested(term), 250);
    return () => clearTimeout(timer);
  }, [term]);
  const query = useAccountingQuery<GuideWork[]>(
    work ? "" : `${guidePath}/works?search=${encodeURIComponent(requested)}`,
  );
  const works = query.data ?? [];
  const loading = query.loading || term !== requested;
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
            disabled={!selected}
            onClick={() => setWork(selected)}
          >
            Continuar
          </Button>
        </footer>
      }
    >
      <div className="dispatch-stack">
        <Field label="Obra" htmlFor={selectorId}>
          <SearchableSelect
            id={selectorId}
            label="Obra"
            placeholder="Busca por nombre o distrito"
            value={selected?.id ?? ""}
            selectedLabel={selected?.name}
            options={works.map(({ id, name, district }) => ({
              value: id,
              label: name,
              description: district,
            }))}
            onChange={(id) => setSelected(works.find((item) => item.id === id))}
            search={{
              onChange: setSearch,
              loading,
              error: loading ? undefined : query.error,
              empty: term
                ? "No encontramos obras con esa búsqueda."
                : "No hay obras en coordinación o ejecución.",
            }}
          />
        </Field>
        {query.error && !loading && <QueryState {...query} />}
      </div>
    </Modal>
  );
}
