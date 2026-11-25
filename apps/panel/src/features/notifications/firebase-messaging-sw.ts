/// <reference lib="webworker" />
import { initializeApp } from "@firebase/app";
import { getMessaging, onBackgroundMessage } from "@firebase/messaging/sw";
import { isNotificationHref } from "./notification-route";
declare const self: ServiceWorkerGlobalScope;
const configuration = JSON.parse(
  new URL(self.location.href).searchParams.get("config") || "{}",
);
self.addEventListener("notificationclick", (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  let destination: URL;
  try {
    destination = new URL(
      event.notification.data?.url || "/",
      self.location.origin,
    );
  } catch {
    return;
  }
  if (
    destination.origin !== self.location.origin ||
    !isNotificationHref(destination.hash)
  )
    return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find(
        (client) => new URL(client.url).origin === destination.origin,
      );
      if (existing) {
        await existing.focus();
        existing.postMessage({
          type: "veca-notification-open",
          href: destination.hash,
          id: event.notification.data?.id,
        });
      } else {
        if (/^[a-f0-9]{64}$/.test(event.notification.data?.id || ""))
          destination.searchParams.set("notice", event.notification.data.id);
        await self.clients.openWindow(destination.href);
      }
    })(),
  );
});
if (configuration.firebase && configuration.apiUrl) {
  const app = initializeApp(configuration.firebase, "veca-notifications");
  onBackgroundMessage(getMessaging(app), async ({ data }) => {
    if (!data || !/^[a-f0-9]{64}$/.test(data.id || "")) return;
    // Verify the current browser session before showing an in-flight push after logout/account changes.
    const response = await fetch(
      `${configuration.apiUrl}/account/notifications/${data.id}`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    await self.registration.showNotification(
      data.title || "VECA · Nuevo aviso",
      {
        body: data.body || "Tienes una actualización en tu espacio de trabajo.",
        icon: "/assets/favicon.svg",
        tag: data.id,
        data: { id: data.id, url: data.url },
      },
    );
  });
}
