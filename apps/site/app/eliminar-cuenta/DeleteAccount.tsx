"use client";
import { useRef, useState, type FormEvent } from "react";
import { FormSubmitButton } from "@veca/ui/src/FormSubmitButton";
import { confirmGoogle, galleryRequest } from "../../lib/gallery-account";

export function DeleteAccount({ api }: { api: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);

  async function remove(proof: () => Promise<unknown>) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await galleryRequest(api, "/account/delete", await proof());
      dialog.current?.close();
      setDeleted(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos eliminar la cuenta. Intenta nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void remove(async () => ({
      username: data.get("username"),
      password: data.get("password"),
    }));
  }

  if (deleted)
    return (
      <p className="ve-gallery-result" role="status">
        Tu cuenta de VECA se eliminó y se cerraron sus sesiones.
      </p>
    );
  return (
    <>
      <button
        className="ve-gallery-button danger"
        onClick={() => {
          setError("");
          setPasswordMode(false);
          dialog.current?.showModal();
        }}
      >
        Eliminar mi cuenta
      </button>
      <dialog
        ref={dialog}
        className="ve-gallery-dialog"
        aria-labelledby="delete-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <h2 id="delete-title">¿Eliminar tu cuenta?</h2>
        <p>
          Confirma tu identidad para eliminar de forma permanente tu perfil y el
          acceso a Galería VECA y al panel.
        </p>
        {passwordMode ? (
          <form onSubmit={submit} className="ve-gallery-actions">
            <label>
              Correo o usuario
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={180}
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <FormSubmitButton
              className="ve-gallery-button danger"
              disabled={busy}
            >
              Eliminar definitivamente
            </FormSubmitButton>
            <button
              type="button"
              className="ve-gallery-button secondary"
              disabled={busy}
              onClick={() => {
                setPasswordMode(false);
                setError("");
              }}
            >
              Usar Google
            </button>
          </form>
        ) : (
          <div className="ve-gallery-actions">
            <button
              className="ve-gallery-button danger"
              disabled={busy}
              onClick={() =>
                void remove(async () => ({ idToken: await confirmGoogle(api) }))
              }
            >
              Confirmar con Google y eliminar
            </button>
            <button
              className="ve-gallery-button secondary"
              disabled={busy}
              onClick={() => {
                setPasswordMode(true);
                setError("");
              }}
            >
              Usar correo y contraseña
            </button>
          </div>
        )}
        {busy && <p role="status">Confirmando la eliminación…</p>}
        {error && (
          <p className="ve-gallery-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="ve-gallery-cancel"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          Cancelar
        </button>
      </dialog>
    </>
  );
}
