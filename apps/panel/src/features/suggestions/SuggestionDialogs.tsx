import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Select } from "@veca/ui/src/Select";
import {
  SUGGESTION_SECTIONS,
  SUGGESTION_STATUSES,
  suggestionCreate,
  suggestionEdit,
  suggestionCommentCreate,
  type Suggestion,
  type SuggestionComment,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
export const suggestionsPath = "/admin/suggestions";
const write = <T,>(path: string, data: unknown, method = "POST") =>
  api<T>(path, {
    method,
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });

function ForumForm<T>({
  title,
  action,
  close,
  save,
  done,
  children,
  hasChanges = false,
}: {
  title: string;
  action: string;
  close: () => void;
  save: (form: FormData) => Promise<T>;
  done: (result: T) => void;
  children: ReactNode;
  hasChanges?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const clearGuard = useUnsavedChanges(dirty || hasChanges, busy);
  const dismiss = () => {
    if (confirmDiscard(dirty || hasChanges, busy)) close();
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await save(form);
      clearGuard();
      setDirty(false);
      done(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={dismiss}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={dismiss}
          >
            Cancelar
          </Button>
          <Button type="submit" form={id} disabled={busy}>
            {busy ? "Guardando…" : action}
          </Button>
        </footer>
      }
    >
      <form
        id={id}
        className="suggestion-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
      >
        <fieldset disabled={busy}>{children}</fieldset>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
export function TopicDialog({
  initial,
  close,
  saved,
}: {
  initial?: Suggestion;
  close: () => void;
  saved: (topic: Suggestion) => void;
}) {
  const id = useRef(crypto.randomUUID());
  const [section, setSection] = useState(initial?.section || "general");
  return (
    <ForumForm
      title={initial ? "Editar sugerencia" : "Nueva sugerencia"}
      action={initial ? "Guardar cambios" : "Publicar sugerencia"}
      close={close}
      done={saved}
      hasChanges={section !== (initial?.section || "general")}
      save={async (form) => {
        const content = {
          title: String(form.get("title") || ""),
          body: String(form.get("body") || ""),
          section,
        };
        const parsed = initial
          ? suggestionEdit.safeParse({ ...content, version: initial.version })
          : suggestionCreate.safeParse({ ...content, id: id.current });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        return write<Suggestion>(
          initial ? `${suggestionsPath}/${initial.id}` : suggestionsPath,
          parsed.data,
          initial ? "PUT" : "POST",
        );
      }}
    >
      <Field label="Título">
        <input
          name="title"
          required
          minLength={4}
          maxLength={120}
          defaultValue={initial?.title}
          placeholder="Por ejemplo: encontrar pedidos por proveedor"
        />
      </Field>
      <Field label="Sección de la plataforma">
        <Select
          label="Sección de la plataforma"
          value={section}
          onChange={(value) => setSection(value as Suggestion["section"])}
          options={Object.entries(SUGGESTION_SECTIONS).map(
            ([value, label]) => ({ value, label }),
          )}
        />
      </Field>
      <Field label="¿Qué mejorarías?">
        <textarea
          name="body"
          required
          minLength={10}
          maxLength={3000}
          rows={6}
          defaultValue={initial?.body}
          placeholder="Cuéntanos qué te cuesta hacer y cómo te ayudaría la mejora."
        />
      </Field>
      <p className="hint">
        Tu sugerencia y los comentarios serán visibles para el equipo de VECA.
      </p>
    </ForumForm>
  );
}
export function CommentDialog({
  topicId,
  close,
  saved,
}: {
  topicId: string;
  close: () => void;
  saved: () => void;
}) {
  const id = useRef(crypto.randomUUID());
  return (
    <ForumForm
      title="Comentar sugerencia"
      action="Publicar comentario"
      close={close}
      done={saved}
      save={async (form) => {
        const result = suggestionCommentCreate.safeParse({
          id: id.current,
          body: String(form.get("body") || ""),
        });
        if (!result.success) throw new Error(result.error.issues[0].message);
        return write<SuggestionComment>(
          `${suggestionsPath}/${topicId}/comments`,
          result.data,
        );
      }}
    >
      <Field label="Tu comentario">
        <textarea
          name="body"
          required
          minLength={2}
          maxLength={2000}
          rows={5}
          placeholder="Aporta un ejemplo o una idea para mejorar esta propuesta."
        />
      </Field>
    </ForumForm>
  );
}
export function StatusDialog({
  topic,
  close,
  saved,
}: {
  topic: Suggestion;
  close: () => void;
  saved: () => void;
}) {
  const [status, setStatus] = useState(topic.status);
  return (
    <ForumForm
      title="Cambiar estado de la sugerencia"
      action="Guardar estado"
      close={close}
      done={saved}
      hasChanges={status !== topic.status}
      save={() =>
        write<Suggestion>(
          `${suggestionsPath}/${topic.id}/status`,
          { status, version: topic.version },
          "PUT",
        )
      }
    >
      <Field label="Estado">
        <Select
          label="Estado de la sugerencia"
          value={status}
          onChange={(value) => setStatus(value as Suggestion["status"])}
          options={Object.entries(SUGGESTION_STATUSES).map(
            ([value, label]) => ({ value, label }),
          )}
        />
      </Field>
      <p className="hint">
        El equipo verá este estado. Puedes explicar la decisión en los
        comentarios.
      </p>
    </ForumForm>
  );
}
