import { Injectable } from "@nestjs/common";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { config } from "../common/config";
@Injectable()
export class FirebasePush {
  get configured() {
    let credentialReady =
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS || this.testing;
    if (config.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const account = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT);
        credentialReady =
          account.project_id === config.FIREBASE_PROJECT_ID &&
          typeof account.client_email === "string" &&
          typeof account.private_key === "string" &&
          account.private_key.includes("BEGIN PRIVATE KEY");
      } catch {
        credentialReady = false;
      }
    }
    return !!(
      config.FIREBASE_PROJECT_ID &&
      config.FIREBASE_API_KEY &&
      config.FIREBASE_APP_ID &&
      /^[\w-]{87}=?$/.test(config.FIREBASE_WEB_PUSH_KEY) &&
      credentialReady
    );
  }
  private get testing() {
    return config.NODE_ENV === "test" && !!config.FIREBASE_PUSH_TEST_ENDPOINT;
  }
  configuration() {
    return {
      enabled: this.configured,
      ...(this.configured
        ? {
            firebase: {
              projectId: config.FIREBASE_PROJECT_ID,
              apiKey: config.FIREBASE_API_KEY,
              appId: config.FIREBASE_APP_ID,
              authDomain: config.FIREBASE_AUTH_DOMAIN,
              messagingSenderId: config.FIREBASE_APP_ID.split(":")[1],
            },
            vapidKey: config.FIREBASE_WEB_PUSH_KEY,
          }
        : {}),
    };
  }
  async send(
    token: string,
    notification: { id: string; title: string; href: string },
  ) {
    // Lock-screen content is deliberately generic; the authenticated panel holds the details.
    const message = {
      token,
      data: {
        id: notification.id,
        title: "VECA · " + notification.title,
        body: "Tienes una actualización en tu espacio de trabajo.",
        url: config.PANEL_ORIGIN + "/" + notification.href,
      },
      webpush: {
        headers: { TTL: "3600" },
        fcmOptions: { link: config.PANEL_ORIGIN + "/" + notification.href },
      },
    };
    if (this.testing) {
      const endpoint = new URL(config.FIREBASE_PUSH_TEST_ENDPOINT);
      if (!["localhost", "127.0.0.1"].includes(endpoint.hostname))
        throw Error("Local push fixture required");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error("Local push fixture failed");
      return;
    }
    const credentials = config.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(config.FIREBASE_SERVICE_ACCOUNT)
      : undefined;
    if (credentials && credentials.project_id !== config.FIREBASE_PROJECT_ID)
      throw Error("Firebase project mismatch");
    const app =
      getApps().find((app) => app.name === "veca-push") ||
      initializeApp(
        {
          projectId: config.FIREBASE_PROJECT_ID,
          credential: credentials ? cert(credentials) : applicationDefault(),
        },
        "veca-push",
      );
    await getMessaging(app).send(message);
  }
}
