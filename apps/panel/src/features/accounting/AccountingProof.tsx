import { useState } from "react";
import { ACCOUNTING_PROOF_MAX_BYTES } from "@veca/content";
import { FileInput } from "../../components/FileInput";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";

export function uploadAccountingProof<T>(recordPath: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return api<T>(recordPath + "/proof", { method: "POST", body });
}

export function AccountingProofField({
  file,
  onSelect,
  onClear,
  hint = "Opcional al guardar. Adjunta una foto JPG, PNG o WebP, o un PDF de hasta 8 MB.",
  disabled,
}: {
  file?: File | null;
  onSelect: (file: File) => void;
  onClear?: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <FileInput
        label="Sustento del comprobante"
        hint={hint}
        file={file}
        disabled={disabled}
        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!selected) return;
          if (!selected.size || selected.size > ACCOUNTING_PROOF_MAX_BYTES) {
            setError("El archivo debe tener contenido y pesar hasta 8 MB.");
            return;
          }
          setError("");
          onSelect(selected);
        }}
      />
      {file && onClear && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setError("");
            onClear();
          }}
        >
          Quitar archivo
        </Button>
      )}
      {error && <Notice error>{error}</Notice>}
    </>
  );
}

export function AccountingProofRetry({
  initialFile,
  initialError,
  onUpload,
  onSkip,
}: {
  initialFile: File;
  initialError: string;
  onUpload: (file: File) => Promise<void>;
  onSkip: () => void;
}) {
  const [file, setFile] = useState(initialFile);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onUpload(file);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Sustento pendiente"
      description="El registro se guardó. Puedes reintentar el adjunto o dejarlo para después."
      onClose={onSkip}
      busy={busy}
      footer={
        <footer className="ve-modal-actions">
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            Dejar para después
          </Button>
          <Button disabled={busy} onClick={() => void retry()}>
            {busy ? "Adjuntando…" : "Reintentar adjunto"}
          </Button>
        </footer>
      }
    >
      <AccountingProofField file={file} onSelect={setFile} disabled={busy} />
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
