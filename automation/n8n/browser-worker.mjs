import { createServer } from "node:http";

const selenium = "http://browser:4444";
const platforms = [
  { name: "Instagram", url: "https://www.instagram.com/" },
  { name: "Facebook", url: "https://www.facebook.com/" },
  { name: "LinkedIn", url: "https://www.linkedin.com/" },
];
const targets = {
  publications: [
    [
      "Instagram",
      "https://business.facebook.com/latest/composer/?asset_id=103191075272076",
      ["Crear publicación", "Create post"],
    ],
    [
      "Facebook",
      "https://www.facebook.com/profile.php?id=100067480520763",
      ["Administrar página", "Manage Page"],
    ],
    [
      "LinkedIn",
      "https://www.linkedin.com/company/146994344/admin/dashboard/",
      ["Ver como miembro", "View as member"],
    ],
  ],
  inboxes: [
    ["Instagram", "https://www.instagram.com/direct/inbox/", ["vecavidrios"]],
    [
      "Facebook",
      "https://business.facebook.com/latest/inbox/all/?asset_id=103191075272076",
      ["Bandeja de entrada", "Inbox"],
    ],
    [
      "LinkedIn",
      "https://www.linkedin.com/company/146994344/admin/inbox/",
      ["Buzón", "Inbox"],
    ],
  ],
};

let session;
let tabs = new Map();
let error = false;
let inspecting = false;
let monitoring;
const nextCheck = new Map();
const reportedChecks = new Map();
const checkInterval = { publications: 15 * 60000, inboxes: 5 * 60000 };
const actions = process.argv[2]
  ? (
      await import("data:text/javascript;base64," + process.argv[2])
    ).createSocialActions({
      driver,
      currentSession: () => session,
      targets,
      inspectPage,
    })
  : null;

async function driver(path, method = "GET", payload) {
  const response = await fetch(selenium + path, {
    method,
    ...(payload && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    signal: AbortSignal.timeout(
      method === "POST" && path === "/session" ? 90000 : 25000,
    ),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(result.value?.error || "webdriver");
  }
  return result.value;
}

async function startBrowser() {
  const grid = await driver("/status");
  const existing = grid.nodes
    ?.flatMap((node) => node.slots)
    .find((slot) => slot.session)?.session.sessionId;
  if (existing) {
    session = existing;
    const handles = await driver(`/session/${session}/window/handles`);
    if (handles.length >= platforms.length) {
      tabs = new Map(
        platforms.map(({ name }, index) => [name, handles[index]]),
      );
      return;
    }
    // Only rebuild tabs in a fresh or incomplete browser session.
  } else {
    const created = await driver("/session", "POST", {
      capabilities: {
        alwaysMatch: {
          browserName: "chrome",
          pageLoadStrategy: "eager",
          "goog:chromeOptions": {
            args: [
              "--user-data-dir=/home/seluser/veca-profile",
              "--profile-directory=Default",
              "--disable-search-engine-choice-screen",
              "--no-first-run",
            ],
            prefs: {
              credentials_enable_service: false,
              "profile.password_manager_enabled": false,
            },
          },
        },
      },
    });
    session = created.sessionId;
  }

  const root = `/session/${session}`;
  const first = await driver(root + "/window");
  tabs.clear();
  for (const [index, platform] of platforms.entries()) {
    const handle =
      index === 0
        ? first
        : (await driver(root + "/window/new", "POST", { type: "tab" })).handle;
    await driver(root + "/window", "POST", { handle });
    // Wait for the address to be committed, without requiring every social asset to load.
    await driver(root + "/timeouts", "POST", { pageLoad: 20000 });
    try {
      await driver(root + "/url", "POST", { url: platform.url });
    } catch (cause) {
      if (cause.message !== "timeout") throw cause;
    }
    tabs.set(platform.name, handle);
  }
  await driver(root + "/window", "POST", { handle: first });
}

async function maintain() {
  try {
    if (session) {
      try {
        await driver(`/session/${session}/window/handles`);
      } catch (cause) {
        if (cause.message !== "invalid session id") throw cause;
        session = undefined;
        tabs.clear();
      }
    }
    if (!session || tabs.size !== platforms.length) await startBrowser();
    error = false;
    const due = Object.keys(checkInterval).find(
      (group) => Date.now() >= (nextCheck.get(group) || 0),
    );
    if (
      actions &&
      process.env.SOCIAL_DELIVERY_TOKEN &&
      due &&
      !inspecting &&
      !monitoring
    )
      monitoring = refreshChecks(due).finally(() => {
        monitoring = undefined;
      });
  } catch {
    error = true;
  } finally {
    setTimeout(maintain, 15000);
  }
}

function inspectPage(expectedUrl, signals) {
  const page = new URL(expectedUrl);
  const samePage =
    location.origin === page.origin &&
    location.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "") &&
    [...page.searchParams].every(
      ([key, value]) => new URLSearchParams(location.search).get(key) === value,
    );
  if (!samePage) {
    return /login|signin|checkpoint|challenge|authwall/i.test(location.pathname)
      ? "login"
      : "redirected";
  }
  const visible = (element) =>
    element.getClientRects().length > 0 &&
    !element.closest("[aria-hidden=true]");
  const verification = [...document.querySelectorAll('[role="dialog"]')].some(
    (dialog) =>
      visible(dialog) &&
      /se requiere verificaci[oó]n|confirma tu identidad|verification required|confirm your identity/i.test(
        dialog.innerText,
      ),
  );
  if (verification) return "login";
  const controls = Array.from(
    document.querySelectorAll(
      "a,button,header,h1,h2,[role=button],[role=heading]",
    ),
  ).filter(visible);
  const normalize = (text) =>
    text
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const labels = new Set([
    ...(document.body?.innerText ?? "").split("\n").map(normalize),
    ...controls.map((element) =>
      normalize(
        element.getAttribute("aria-label") ||
          element.innerText ||
          element.textContent ||
          "",
      ),
    ),
  ]);
  return signals.some((signal) => labels.has(signal))
    ? "verified"
    : "unconfirmed";
}

async function inspectAccounts(group) {
  const root = `/session/${session}`;
  const original = await driver(root + "/window");
  const select = (handle) => driver(root + "/window", "POST", { handle });
  const scratch = (await driver(root + "/window/new", "POST", { type: "tab" }))
    .handle;
  const accounts = [];
  try {
    await select(scratch);
    for (const [platform, url, signals] of targets[group]) {
      try {
        await driver(root + "/url", "POST", { url });
        let status;
        const deadline = Date.now() + 14000;
        do {
          status = await driver(root + "/execute/sync", "POST", {
            script: "return (" + inspectPage.toString() + ")(...arguments);",
            args: [url, signals],
          });
          if (status === "verified" || status === "login") break;
          await new Promise((resolve) => setTimeout(resolve, 650));
        } while (Date.now() < deadline);
        if (
          actions &&
          status === "verified" &&
          group === "publications" &&
          platform === "Instagram" &&
          !(await actions.checkInstagramAccount(root))
        )
          status = "unconfirmed";
        accounts.push({ platform, status });
      } catch {
        accounts.push({ platform, status: "unavailable" });
      }
    }
  } finally {
    try {
      await select(scratch);
      await driver(root + "/window", "DELETE");
    } finally {
      await select(original);
    }
  }
  return accounts;
}

async function refreshChecks(group) {
  try {
    const accounts = await inspectAccounts(group).catch(() =>
      targets[group].map(([platform]) => ({ platform, status: "unavailable" })),
    );
    const { checkedAt } = await actions.reportHealth(group, accounts);
    reportedChecks.set(group, { checkedAt, accounts });
    nextCheck.set(group, Date.now() + checkInterval[group]);
  } catch {
    nextCheck.set(group, Date.now() + 60000);
  }
}

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const ready = Boolean(session) && !error && tabs.size === platforms.length;
  if (req.method === "GET" && req.url === "/status") {
    return reply(res, ready ? 200 : 503, {
      ready,
      platforms: [...tabs.keys()],
      checks: Object.fromEntries(reportedChecks),
    });
  }
  const group = /^\/verify\/(publications|inboxes)$/.exec(req.url)?.[1];
  const runAction = {
    "/verify/composers": actions?.verifyComposers,
    "/verify/composers/facebook":
      actions && (() => actions.verifyComposers("facebook")),
    "/verify/composers/instagram":
      actions && (() => actions.verifyComposers("instagram")),
    "/tick/publications": actions?.publish,
    "/tick/inboxes": actions?.inbox,
  }[req.url];
  if (req.method !== "POST" || (!group && !runAction))
    return reply(res, 404, {});
  if (monitoring) await monitoring;
  if (!ready || inspecting)
    return reply(res, 503, { status: "browser_unavailable" });
  inspecting = true;
  try {
    if (runAction) return reply(res, 200, await runAction());
    const accounts = await inspectAccounts(group);
    reply(res, 200, {
      verified: accounts.every((a) => a.status === "verified"),
      accounts,
    });
  } catch {
    reply(res, 503, { status: "browser_unavailable" });
  } finally {
    inspecting = false;
  }
}).listen(8080, "0.0.0.0");

void maintain();
