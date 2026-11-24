import { getApps, initializeApp } from "@firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "@firebase/messaging";
import type { BrowserPushConfiguration } from "@veca/content";
import { api, API_BASE } from "../../lib/api";
import workerUrl from "./firebase-messaging-sw?worker&url";
import { readPushPreference, writePushPreference } from "./push-preferences";

function setupStep<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function messaging(configuration: BrowserPushConfiguration) {
  if (!configuration.firebase)
    throw Error("Los avisos del navegador aún no están disponibles.");
  const app =
    getApps().find((app) => app.name === "veca-notifications") ||
    initializeApp(configuration.firebase, "veca-notifications");
  return getMessaging(app);
}
export async function connectBrowserPush(
  configuration: BrowserPushConfiguration,
  userId: string,
) {
  const signal = AbortSignal.timeout(20000);
  if (
    !configuration.enabled ||
    !configuration.vapidKey ||
    !(await setupStep(isSupported(), signal))
  )
    throw Error("Este navegador no puede recibir avisos en este momento.");
  const url = new URL(workerUrl, location.origin);
  url.searchParams.set(
    "config",
    JSON.stringify({ firebase: configuration.firebase, apiUrl: API_BASE }),
  );
  const registration = await setupStep(
    navigator.serviceWorker.register(url, {
      scope: "/",
    }),
    signal,
  );
  await setupStep(navigator.serviceWorker.ready, signal);
  const instance = messaging(configuration);
  const token = await setupStep(
    getToken(instance, {
      vapidKey: configuration.vapidKey,
      serviceWorkerRegistration: registration,
    }),
    signal,
  );
  if (!token) throw Error("No pudimos activar los avisos en este navegador.");
  await api("/account/notifications/push/register", {
    method: "POST",
    body: JSON.stringify({ token, accountId: userId }),
    signal,
  });
  writePushPreference("veca.push.owner", userId);
  return onMessage(instance, async (payload) => {
    const data = payload.data;
    if (
      !data ||
      !/^[a-f0-9]{64}$/.test(data.id || "") ||
      (readPushPreference("veca.push.owner") &&
        readPushPreference("veca.push.owner") !== userId)
    )
      return;
    try {
      await api(`/account/notifications/${data.id}`);
      await registration.showNotification(data.title || "VECA · Nuevo aviso", {
        body: data.body || "Tienes una actualización en tu espacio de trabajo.",
        icon: "/assets/favicon.svg",
        tag: data.id,
        data: { id: data.id, url: data.url },
      });
    } catch {
      /* A changed account or revoked access must not display the previous user's notice. */
    }
  });
}
export async function disconnectBrowserPush(
  configuration: BrowserPushConfiguration,
) {
  const signal = AbortSignal.timeout(20000);
  await api("/account/notifications/push/unregister", {
    method: "POST",
    signal,
  });
  writePushPreference("veca.push.owner", null);
  try {
    if (configuration.firebase && (await setupStep(isSupported(), signal)))
      await setupStep(deleteToken(messaging(configuration)), signal);
  } catch {
    /* The server registration is already removed, so this browser receives no further sends. */
  }
}
