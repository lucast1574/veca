export type PanelNotification = {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};
export type NotificationPage = { items: PanelNotification[]; unread: number };
export type BrowserPushConfiguration = {
  enabled: boolean;
  firebase?: {
    projectId: string;
    apiKey: string;
    authDomain: string;
    appId: string;
    messagingSenderId: string;
  };
  vapidKey?: string;
};
