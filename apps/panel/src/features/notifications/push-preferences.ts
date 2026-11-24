export function readPushPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePushPreference(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Internal notices remain available when persistent browser storage is blocked. */
  }
}
