import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, BellRing, CheckCheck } from "lucide-react";
import type {
  BrowserPushConfiguration,
  NotificationPage,
  PanelNotification,
  SessionUser,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { useLiveRefresh } from "../operations/shared";
import {
  QueryState,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import "./notifications.css";
import { readPushPreference, writePushPreference } from "./push-preferences";

export function NotificationBell({ user }: { user: SessionUser }) {
  const query = useAccountingQuery<NotificationPage>("/account/notifications");
  const config = useAccountingQuery<BrowserPushConfiguration>(
    "/account/notifications/config",
  );
  useLiveRefresh(query.refresh, false, true, "/account/notifications/events");
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preference = "veca.push.enabled." + user.id;
  const [enabled, setEnabled] = useState(
    () => readPushPreference(preference) === "1",
  );
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const markNativeRead = (id: unknown) => {
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return;
      void api(`/account/notifications/${id}/read`, { method: "POST" })
        .then(query.refresh)
        .catch(() => {});
    };
    const destination = new URL(location.href),
      notice = destination.searchParams.get("notice");
    if (notice) {
      markNativeRead(notice);
      destination.searchParams.delete("notice");
      history.replaceState(history.state, "", destination);
    }
    const onOpen = (event: MessageEvent) => {
      if (
        event.data?.type === "veca-notification-open" &&
        typeof event.data.href === "string" &&
        /^#(?:works|leads|projects|profile)(?:\/|$)/.test(event.data.href)
      ) {
        markNativeRead(event.data.id);
        location.hash = event.data.href;
      }
    };
    navigator.serviceWorker?.addEventListener("message", onOpen);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onOpen);
  }, [query.refresh]);
  useEffect(() => {
    if (!config.data?.enabled) return;
    let cancelled = false;
    const setup = async () => {
      const push = await import("./browser-push");
      const previous = readPushPreference("veca.push.owner");
      if (previous && previous !== user.id)
        await push.disconnectBrowserPush(config.data!);
      if (
        cancelled ||
        !enabled ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
      )
        return;
      const unsubscribe = await push.connectBrowserPush(config.data!, user.id);
      if (cancelled) unsubscribe();
      else stop.current = unsubscribe;
    };
    void setup().catch(() => {
      if (!cancelled)
        setError(
          "No pudimos conectar los avisos del navegador. Puedes volver a activarlos desde aquí.",
        );
    });
    return () => {
      cancelled = true;
      stop.current?.();
      stop.current = undefined;
    };
  }, [config.data, enabled, user.id]);
  async function togglePush() {
    if (busy || !config.data?.enabled) return;
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        stop.current?.();
        stop.current = undefined;
        await (
          await import("./browser-push")
        ).disconnectBrowserPush(config.data);
        writePushPreference(preference, null);
        setEnabled(false);
      } else {
        if (!("Notification" in window) || !navigator.serviceWorker) {
          setError("Este navegador no admite avisos del sistema.");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError(
            permission === "denied"
              ? "Los avisos están bloqueados en los permisos del navegador. Habilítalos para este sitio y vuelve a intentarlo."
              : "Puedes activar los avisos cuando quieras.",
          );
          return;
        }
        const unsubscribe = await (
          await import("./browser-push")
        ).connectBrowserPush(config.data, user.id);
        stop.current?.();
        stop.current = unsubscribe;
        writePushPreference(preference, "1");
        setEnabled(true);
      }
    } catch {
      setError(
        "No pudimos cambiar los avisos del navegador. Revisa los permisos de este sitio y vuelve a intentarlo.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function visit(notice: PanelNotification) {
    try {
      await api(`/account/notifications/${notice.id}/read`, { method: "POST" });
      query.refresh();
      setOpen(false);
      location.hash = notice.href;
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <>
      <button
        type="button"
        className="notification-bell"
        aria-label={
          query.data?.unread
            ? `Avisos: ${query.data.unread} sin leer`
            : "Avisos"
        }
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          query.refresh();
        }}
      >
        <Bell size={20} />
        {!!query.data?.unread && (
          <span>{query.data.unread > 99 ? "99+" : query.data.unread}</span>
        )}
      </button>
      {open && (
        <Modal
          title="Tus avisos"
          description="Las novedades que necesitan tu atención, en un solo lugar."
          onClose={() => setOpen(false)}
          busy={busy}
        >
          <div className="notification-tools">
            <span>{query.data?.unread || 0} sin leer</span>
            <Button
              variant="ghost"
              disabled={!query.data?.unread || busy}
              onClick={() => {
                void api("/account/notifications/read", { method: "POST" })
                  .then(query.refresh)
                  .catch((error: Error) => setError(error.message));
              }}
            >
              <CheckCheck size={16} />
              Marcar todos leídos
            </Button>
          </div>
          <QueryState {...query}>
            {query.data?.items.length ? (
              <ul className="notification-list">
                {query.data.items.map((notice) => (
                  <li key={notice.id} data-unread={!notice.readAt || undefined}>
                    <button type="button" onClick={() => void visit(notice)}>
                      <span className="notification-dot" aria-hidden="true" />
                      <span>
                        <strong>{notice.title}</strong>
                        <p>{notice.body}</p>
                        <small>
                          {new Date(notice.createdAt).toLocaleString("es-PE", {
                            timeZone: "America/Lima",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="notification-empty">
                <Bell size={28} />
                <p>Estás al día.</p>
                <span>Los nuevos avisos aparecerán aquí.</span>
              </div>
            )}
          </QueryState>
          <section className="notification-browser">
            <BellRing size={20} />
            <div>
              <strong>Avisos del navegador</strong>
              <p>
                {enabled
                  ? "También recibirás avisos cuando estés en otra pestaña."
                  : "Actívalos para enterarte de las novedades fuera del panel."}
              </p>
              {config.data?.enabled ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void togglePush()}
                >
                  {busy
                    ? "Conectando…"
                    : enabled
                      ? "Desactivar en este navegador"
                      : "Activar en este navegador"}
                </Button>
              ) : (
                <small>
                  Disponibles cuando termine la configuración de avisos.
                </small>
              )}
            </div>
          </section>
          {error && <Notice error>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
