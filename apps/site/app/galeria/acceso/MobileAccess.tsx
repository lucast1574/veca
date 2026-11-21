"use client";
import { useState } from "react";
import { confirmGoogle, galleryRequest } from "../../../lib/gallery-account";

export function MobileAccess({ api }: { api: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  async function connect() {
    const challenge =
      new URLSearchParams(location.hash.slice(1)).get("challenge") || "";
    if (!/^[a-f0-9]{64}$/.test(challenge)) {
      setError("Abre Galería VECA e inicia el acceso con Google desde la app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { code } = await galleryRequest<{ code: string }>(
        api,
        "/mobile/auth/google",
        {
          challenge,
          idToken: await confirmGoogle(api),
        },
      );
      setLink("vecagaleria://acceso?code=" + encodeURIComponent(code));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Intenta iniciar sesión nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {link ? (
        <a className="ve-gallery-button" href={link}>
          Volver a Galería VECA
        </a>
      ) : (
        <button
          className="ve-gallery-button"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? "Comprobando tu cuenta…" : "Continuar con Google"}
        </button>
      )}
      {error && (
        <p className="ve-gallery-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
