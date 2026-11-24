import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  GALLERY_PHOTO_MAX_BYTES,
  GALLERY_PHOTO_NAME_MAX,
  type GalleryUploadPhoto,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { ImagePlus, Upload } from "lucide-react";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { api } from "../../lib/api";

const categories = CATEGORIES.map(({ id, name }) => ({
  value: id,
  label: name,
}));

export function GalleryUploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (photo: GalleryUploadPhoto) => void;
}) {
  const formId = useId();
  const categoryId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const submissionId = useRef<string | null>(null);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function close() {
    if (busy) return;
    if (
      (!file && !name && !category) ||
      window.confirm("¿Cerrar sin subir la foto?")
    )
      onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file || !name.trim() || !category) return;
    setBusy(true);
    setError("");
    const body = new FormData();
    submissionId.current ??= crypto.randomUUID();
    body.append("submissionId", submissionId.current);
    body.append("file", file);
    body.append("name", name.trim());
    body.append("category", category);
    try {
      const photo = await api<GalleryUploadPhoto>("/admin/gallery/photos", {
        method: "POST",
        body,
      });
      onUploaded(photo);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Subir foto"
      description="Guárdala en la galería privada del equipo."
      className="gallery-upload"
      busy={busy}
      onClose={close}
      footer={
        <div className="ve-modal-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !file || !name.trim() || !category}
          >
            <Upload size={17} /> {busy ? "Subiendo…" : "Subir foto"}
          </Button>
        </div>
      }
    >
      <form id={formId} className="gallery-upload-form" onSubmit={submit}>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif"
          hidden
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (!next) return;
            if (next.size > GALLERY_PHOTO_MAX_BYTES) {
              setError("La foto debe pesar hasta 12 MB.");
              return;
            }
            setError("");
            setFile(next);
          }}
        />
        <button
          className="gallery-upload-picker"
          type="button"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          {file && preview ? (
            <img
              src={preview}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
              key={preview}
            />
          ) : (
            <ImagePlus size={27} aria-hidden="true" />
          )}
          <span>{file ? "Cambiar foto" : "Elegir foto"}</span>
          <small>{file?.name || "JPG, PNG, WebP o AVIF · Hasta 12 MB"}</small>
        </button>
        <Field label="Nombre de la foto">
          <input
            type="text"
            required
            value={name}
            maxLength={GALLERY_PHOTO_NAME_MAX}
            placeholder="Ej. Mampara de la terraza"
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Categoría" htmlFor={categoryId}>
          <Select
            floating
            id={categoryId}
            label="Categoría"
            options={categories}
            value={category}
            onChange={setCategory}
            placeholder="Selecciona una categoría"
            disabled={busy}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
      </form>
    </Modal>
  );
}
