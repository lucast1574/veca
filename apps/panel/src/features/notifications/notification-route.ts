export function isNotificationHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^#(?:works|leads|projects|profile|accounting)(?:\/|$)/.test(value)
  );
}
