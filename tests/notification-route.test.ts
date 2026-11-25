import { test } from "node:test";
import assert from "node:assert/strict";
import { isNotificationHref } from "../apps/panel/src/features/notifications/notification-route";

test("notification links support accounting discounts and retain the internal route boundary", () => {
  for (const value of [
    "#works/abc",
    "#leads/abc",
    "#projects/from-work/abc",
    "#profile",
    "#accounting/personal?month=2026-11&section=descuentos",
  ])
    assert.equal(isNotificationHref(value), true, value);
  for (const value of [
    "https://other.test/#accounting/personal",
    "javascript:alert(1)",
    "#accounting-other",
    "#unknown",
    "",
    null,
    {},
  ])
    assert.equal(isNotificationHref(value), false, String(value));
});
