import { useId, useState } from "react";
import { CATEGORIES, type ProjectInput } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import "./project-create.css";
import { ProjectLocation } from "./ProjectLocation";

export type ProjectStart = Pick<
  ProjectInput,
  "title" | "category" | "location"
>;
export function ProjectCreateDialog({
  close,
  next,
}: {
  close: () => void;
  next: (data: ProjectStart) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [category, setCategory] =
    useState<ProjectInput["category"]>("viviendas");
  const [location, setLocation] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const clearGuard = useUnsavedChanges(dirty);
  const onClose = () => {
    if (confirmDiscard(dirty)) {
      clearGuard();
      close();
    }
  };
  return (
    <Modal
      title="Nuevo proyecto"
      description="Empieza con los datos de la obra. En el editor podrás añadir fotos y preparar la publicación."
      onClose={onClose}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={id}>
            Abrir editor
          </Button>
        </footer>
      }
    >
      <form
        id={id}
        className="project-create-form"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim().length < 4 || !location) {
            setError(
              "Escribe un nombre de al menos cuatro caracteres y completa la ubicación.",
            );
            return;
          }
          clearGuard();
          next({ title: title.trim(), category, location });
        }}
      >
        <Field label="Nombre del proyecto">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={4}
            maxLength={140}
          />
        </Field>
        <Field label="Categoría">
          <Select
            floating
            label="Categoría"
            value={category}
            options={CATEGORIES.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={(value) => {
              setCategory(value as ProjectInput["category"]);
              setDirty(true);
            }}
          />
        </Field>
        <ProjectLocation
          value={location}
          onChange={(value) => {
            setLocation(value);
            setDirty(true);
          }}
        />
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
