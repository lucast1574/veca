"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  REQUEST_TYPES,
  publicLeadSchema,
  socialLeadSchema,
  type SocialChannel,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { WHATSAPP } from "./content";
import { Arrow } from "./Controls";
export function ProjectContact({
  submissionUrl,
  source,
}: {
  submissionUrl: string;
  source?: SocialChannel;
}) {
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const operation = useRef("");
  const trigger = useRef<HTMLButtonElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!type) {
      setError("Elige el tipo de trabajo que tienes en mente.");
      trigger.current?.focus();
      return;
    }
    const form = new FormData(event.currentTarget);
    if (!operation.current) operation.current = crypto.randomUUID();
    const data = {
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
      website: String(form.get("website") || ""),
      idea: String(form.get("idea") || ""),
      requestType: type,
      submissionId: operation.current,
    };
    const parsed = source
      ? socialLeadSchema.safeParse({ ...data, source })
      : publicLeadSchema.safeParse({
          ...data,
          district: String(form.get("district") || ""),
        });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(submissionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json();
      if (!response.ok)
        throw Error(
          body.message || "No pudimos guardar la consulta. Inténtalo otra vez.",
        );
      setReference(body.reference);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "No pudimos conectar. Intenta nuevamente o escríbenos por WhatsApp."
          : (e as Error).message ||
              "No pudimos conectar. Intenta nuevamente o escríbenos por WhatsApp.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={source ? "ve-inquiry ve-inquiry--social" : "ve-inquiry"}
      id="contacto"
      aria-labelledby={source ? "ve-social-contact-title" : "ve-contact-title"}
    >
      <div className="ve-inquiry-scene">
        <img
          src="/assets/vivienda.webp"
          alt={
            source
              ? ""
              : "Ambiente residencial abierto a la luz por sus ventanas"
          }
          width="1600"
          height="1067"
          loading="lazy"
        />
        <div className="ve-inquiry-shade" />
        {!source && (
          <div className="ve-inquiry-heading">
            <h2 id="ve-contact-title">Cotiza tu proyecto</h2>
            <span>
              Ten a mano la ubicación, fotos del espacio y medidas aproximadas.
            </span>
          </div>
        )}
        {!source && (
          <div className="ve-inquiry-contact">
            <span>Envíanos tus fotos o planos por WhatsApp</span>
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
              +51 908 917 621 <Arrow />
            </a>
            <small>WhatsApp Business · Lima y provincias</small>
          </div>
        )}
      </div>
      <div className="ve-inquiry-panel">
        {reference ? (
          <div className="ve-inquiry-success" role="status">
            <span className="ve-success-mark" aria-hidden="true">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            </span>
            <p>Consulta recibida</p>
            <h3 id={source ? "ve-social-contact-title" : undefined}>
              Tu idea ya está
              <br />
              en nuestras manos.
            </h3>
            <p>
              Nuestro equipo te contactará por el teléfono o correo que
              indicaste.
            </p>
            <span>Referencia {reference.slice(-8).toUpperCase()}</span>
            <a
              className="ve-inline-link"
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
            >
              Continuar por WhatsApp <Arrow />
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="ve-inquiry-form-head">
              {source ? (
                <h1
                  id="ve-social-contact-title"
                  className="ve-inquiry-form-title"
                >
                  Hablemos de tu proyecto
                </h1>
              ) : (
                <>
                  <h3>Cuéntanos qué necesitas instalar</h3>
                </>
              )}
              <p>
                {source
                  ? "Déjanos tus datos y cuéntanos qué quieres hacer. Te contactaremos para ayudarte con tu proyecto."
                  : "Indica la ciudad o el distrito y describe el trabajo. Puedes incluir medidas aproximadas."}
              </p>
            </div>
            <div className="ve-inquiry-type">
              <label htmlFor="project-space">¿Qué tienes en mente?</label>
              <Select
                id="project-space"
                label="Tipo de trabajo"
                value={type}
                options={REQUEST_TYPES.map((t) => ({
                  value: t.id,
                  label: t.name,
                  description: t.description,
                }))}
                onChange={(value) => {
                  setType(value);
                  setError("");
                }}
                triggerRef={trigger}
              />
            </div>
            <div className="ve-inquiry-fields">
              <label>
                Tu nombre
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Nombre y apellido"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Teléfono o WhatsApp
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="Ej. +51 908 917 621"
                  required
                  maxLength={30}
                />
              </label>
              <label>
                Correo electrónico
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="tu@correo.com"
                  required
                  maxLength={180}
                />
              </label>
              {!source && (
                <label>
                  Ciudad o distrito de la obra
                  <input
                    name="district"
                    placeholder="Ej. Huancayo, Junín"
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
              )}
            </div>
            <label>
              {source ? "Cuéntanos qué quieres hacer" : "Cuéntanos tu idea"}
              <textarea
                name="idea"
                placeholder={
                  source
                    ? "Por ejemplo, quiero instalar una mampara de vidrio en el baño."
                    : "El espacio, lo que quieres cambiar, medidas aproximadas…"
                }
                required
                minLength={10}
                maxLength={4000}
                rows={3}
              />
            </label>
            <div className="ve-honeypot" aria-hidden="true">
              <label>
                Sitio web
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {error && (
              <p className="ve-inquiry-error" role="alert">
                {error}
              </p>
            )}
            <button className="ve-action" disabled={busy} type="submit">
              {busy ? "Enviando tu consulta…" : "Enviar mi proyecto"}
              <Arrow />
            </button>
            <p className="ve-inquiry-privacy">
              Usaremos tus datos para atender esta consulta y coordinar tu
              proyecto.{" "}
              {source && <a href="/privacidad/">Política de privacidad</a>}
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
