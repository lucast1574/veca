import { crc32 } from "node:zlib";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const network = {
  Instagram: "instagram",
  Facebook: "facebook",
  LinkedIn: "linkedin",
};
const elementId = "element-6066-11e4-a52e-4f735466cecf";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const api = "https://api.veca.com.pe";
const website = "https://veca.com.pe";
const composerSamples = ["/assets/vivienda.webp", "/assets/oficina.webp"].map(
  (path) => website + path,
);
const submitLabels = ["Compartir", "Share", "Publicar", "Publish", "Post"];

function matchControl(labels, scope, kind) {
  const text = (value) => (value || "").trim().replace(/\s+/g, " ");
  const visible = (el) =>
    el.getClientRects().length > 0 && !el.closest("[aria-hidden=true]");
  const matches = new Set();
  for (const root of document.querySelectorAll(scope)) {
    if (!visible(root)) continue;
    const selector =
      kind === "editor"
        ? "[contenteditable=true],textarea"
        : "button,a,[role=button],[role=menuitem],svg[aria-label]";
    for (const el of root.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const isSvg = el.tagName.toLowerCase() === "svg";
      const control = isSvg
        ? el.closest("a,button,[role=button],[role=menuitem]")
        : el;
      if (
        !control ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true"
      )
        continue;
      const signals = [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-placeholder"),
        el.getAttribute("placeholder"),
        kind !== "editor" && el.innerText,
      ];
      if (!labels.length || signals.some((s) => labels.includes(text(s))))
        matches.add(control);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function findMediaInput(scope) {
  const candidates = [
    ...document.querySelectorAll(scope + " input[type=file]"),
  ].filter((input) => /image|jpg|jpeg|png/i.test(input.accept || ""));
  if (candidates.length === 1) return candidates[0];
  const photos = candidates.filter(
    (input) => !/video/i.test(input.accept || ""),
  );
  return photos.length === 1 ? photos[0] : null;
}

function photoPreview(scope, expected) {
  const found = new Map();
  const visible = (element) =>
    element.getClientRects().length && !element.closest("[aria-hidden=true]");
  const dialogs = [...document.querySelectorAll(scope)].filter(visible);
  for (const dialog of dialogs) {
    for (const image of dialog.querySelectorAll("img")) {
      if (
        !visible(image) ||
        !image.complete ||
        Math.min(image.naturalWidth, image.naturalHeight) < 144
      )
        continue;
      const source = image.currentSrc || image.src;
      if (/^(blob:|data:image\/)/i.test(source)) {
        found.set(source, {
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      }
    }
    for (const element of dialog.querySelectorAll("[style]")) {
      if (!visible(element)) continue;
      const image = element.style.backgroundImage;
      if (/^url\(["']?(blob:|data:image\/)/i.test(image)) {
        const box = element.getBoundingClientRect();
        if (Math.min(box.width, box.height) >= 120) {
          const source = image
            .replace(/^url\(["']?/, "")
            .replace(/["']?\)$/, "");
          if (!found.has(source))
            found.set(source, {
              width: Math.round(box.width),
              height: Math.round(box.height),
            });
        }
      }
    }
  }
  // LinkedIn's media editor renders one full image at a time and lists the
  // other uploaded images by filename in its thumbnail controls.
  const selected = new Set(
    dialogs
      .flatMap((dialog) => [...dialog.querySelectorAll("button,[role=button]")])
      .filter(visible)
      .map(
        (button) =>
          (
            button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            ""
          ).match(/^(?:Seleccionar|Select) veca-foto-(\d+)\.jpg$/i)?.[1],
      )
      .filter(Boolean)
      .map(Number),
  );
  const accepted =
    found.size === expected ||
    (found.size > 0 &&
      selected.size === expected &&
      Array.from({ length: expected }, (_, index) => index + 1).every((index) =>
        selected.has(index),
      ));
  return accepted ? { ...found.values().next().value, count: expected } : null;
}

function metaPhotoPreview(expected) {
  const visible = (element) =>
    element.getClientRects().length && !element.closest("[aria-hidden=true]");
  const buttons = [...document.querySelectorAll("button,[role=button]")].filter(
    (button) =>
      visible(button) &&
      /^(Suprimir foto|Eliminar foto|Remove photo|Delete photo)$/i.test(
        (button.getAttribute("aria-label") || button.innerText)
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim(),
      ),
  );
  if (buttons.length !== expected) return null;
  // Meta replaces the local JPEG with its CDN copy in the attachment row.
  for (
    let row = buttons[0].parentElement;
    row && row !== document.body;
    row = row.parentElement
  ) {
    if (row.querySelector('[contenteditable="true"]')) return null;
    const thumbnails = [...row.querySelectorAll("img")].filter((image) => {
      const source = image.currentSrc || image.src;
      return (
        visible(image) &&
        image.complete &&
        Math.min(image.naturalWidth, image.naturalHeight) >= 144 &&
        /^https:\/\/(?:[a-z0-9-]+\.)*fbcdn\.net\//i.test(source)
      );
    });
    if (!thumbnails.length) continue;
    if (
      thumbnails.length < expected ||
      !buttons.every((button) => row.contains(button))
    )
      continue;
    if (thumbnails.length !== expected) return null;
    const [photo] = thumbnails;
    return {
      width: photo.naturalWidth,
      height: photo.naturalHeight,
      count: expected,
    };
  }
  return null;
}

function metaDestination(stage, account = "vecavidrios") {
  const visible = (element) =>
    element.getClientRects().length && !element.closest("[aria-hidden=true]");
  const label = (element) =>
    (element.getAttribute("aria-label") || element.innerText)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const page = "Vidrios VECA";
  const expected = ["vecavidrios", page, page + " y vecavidrios"];
  const choices = [
    ...document.querySelectorAll('[role="combobox"][aria-expanded]'),
  ].filter((control) => visible(control) && expected.includes(label(control)));
  if (choices.length !== 1) return null;
  const chooser = choices[0];
  if (stage === "open") return chooser;
  if (stage === "linked") return label(chooser).includes(account);
  if (stage === "confirmed") {
    return (
      label(chooser) === account &&
      chooser.getAttribute("aria-expanded") === "false"
    );
  }
  const options = [
    ...document.querySelectorAll('[role="listbox"] [role="option"]'),
  ].filter(visible);
  if (stage === "verified") {
    const selected = options.filter(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    return selected.length === 1 && label(selected[0]) === account;
  }
  const wanted = options.filter((option) => label(option) === stage);
  if (wanted.length !== 1) return null;
  return {
    element: wanted[0],
    selected: wanted[0].getAttribute("aria-selected") === "true",
  };
}

function publicationCaption(job, channel) {
  if (job.caption) return job.caption;
  return [job.title, job.description, channel === "linkedin" ? job.url : ""]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
}

function metaPublishedProject(platform, content, url) {
  if (
    location.origin !== "https://business.facebook.com" ||
    !location.pathname.startsWith("/latest/posts/published_posts") ||
    new URLSearchParams(location.search).get("asset_id") !== "103191075272076"
  )
    return false;
  const social = platform === "instagram" ? "Instagram" : "Facebook";
  const text = (value) =>
    (value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const caption = text(content).slice(0, 100).trimEnd();
  const rows = [...document.querySelectorAll('tr,[role="row"]')].filter(
    (row) =>
      row.getClientRects().length &&
      row.querySelector(`img[alt="${social}"]`) &&
      [...row.querySelectorAll('td,[role="cell"],[role="gridcell"]')].some(
        (cell) => {
          const contents = text(cell.innerText);
          return (
            contents.includes(url) || (caption && contents.includes(caption))
          );
        },
      ),
  );
  return rows.length === 1;
}

async function withChrome(session, handle, action) {
  const url =
    "ws://browser:4444/session/" + encodeURIComponent(session) + "/se/cdp";
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = new EventTarget();
  let sequence = 0;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("media")), 6000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(Error("media"));
        },
        { once: true },
      );
    });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) pending.get(message.id)?.(message);
      else if (message.method)
        events.dispatchEvent(
          new CustomEvent(message.method, { detail: message }),
        );
    });
    function send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(Error("media"));
        }, 6000);
        pending.set(id, (message) => {
          pending.delete(id);
          clearTimeout(timeout);
          if (message.error) reject(Error("media"));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }
    const targetId = handle.replace(/^CDwindow-/i, "");
    const { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    return await action(
      (method, params) => send(method, params, sessionId),
      events,
      sessionId,
    );
  } finally {
    socket.close();
  }
}

function composerDiagnostics(platform) {
  const isMeta = platform === "instagram";
  const result = { buttons: [], editors: [], files: [], images: [] };
  const current = (element) =>
    element.getClientRects().length && !element.closest("[aria-hidden=true]");
  for (const el of document.querySelectorAll(
    "button,[role=button],svg[aria-label],[contenteditable=true],textarea,input[type=file],img",
  )) {
    const inDialog = !!el.closest('[role="dialog"]');
    if (el.matches("input[type=file]")) {
      result.files.push({
        inDialog,
        accept: el.accept,
        selected: el.files.length,
      });
    } else if ((isMeta || inDialog) && current(el)) {
      if (el.matches("img")) {
        result.images.push({
          from: /^(blob:|data:image\/)/i.test(el.currentSrc || el.src)
            ? "local-preview"
            : "remote",
          width: el.naturalWidth,
          height: el.naturalHeight,
          ...(isMeta && {
            displayWidth: Math.round(el.getBoundingClientRect().width),
            sourceHost: /^(blob:|data:image\/)/i.test(el.currentSrc || el.src)
              ? undefined
              : new URL(el.currentSrc || el.src, location.href).hostname,
          }),
        });
        continue;
      }
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        ""
      ).trim();
      if (el.matches("[contenteditable=true],textarea")) {
        result.editors.push({
          label,
          placeholder: el.getAttribute("data-placeholder"),
          inserted: (el.value ?? el.textContent ?? "").includes(
            "Vista previa técnica",
          ),
          sampleParts: [
            "Vista previa técnica",
            "Comprobación de texto",
            "veca.com.pe",
          ].map((part) => (el.value ?? el.textContent ?? "").includes(part)),
        });
      } else {
        const hint = label || (isMeta && el.innerText.trim());
        if (hint && hint.length < 70 && !/@|\d{4}/.test(hint))
          result.buttons.push(hint);
      }
    }
  }
  return result;
}

function enterText(el, value) {
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertText",
      }),
    );
  } else {
    const selection = window.getSelection();
    selection.selectAllChildren(el);
    document.execCommand("insertText", false, value);
  }
  return (el.value ?? el.textContent ?? "").length > 0;
}

function hasText(el, value) {
  const compact = (text) =>
    (text || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  const parts = value.split("\n").map(compact).filter(Boolean);
  return [el.value, el.innerText, el.textContent].some((text) => {
    const actual = compact(text);
    let begin = 0;
    return parts.every((part) => {
      const found = actual.indexOf(part, begin);
      if (found === -1) return false;
      begin = found + part.length;
      return true;
    });
  });
}

function publishedNotice(platform) {
  const notices = {
    instagram:
      /your post has been shared|se (ha )?comparti[oó] tu publicaci[oó]n|post shared|se public[oó] tu publicaci[oó]n|publicaci[oó]n publicada|your post (was|has been) published/i,
    facebook:
      /se public[oó] tu publicaci[oó]n|publicaci[oó]n publicada|your post was published|your post has been published/i,
    linkedin:
      /se ha publicado|post published|post was successful|publicaci[oó]n publicada/i,
  };
  return [
    ...document.querySelectorAll(
      '[role="alert"],[role="status"],[role="dialog"],[aria-live]',
    ),
  ].some(
    (el) =>
      el.getClientRects().length > 0 &&
      notices[platform].test(el.innerText || ""),
  );
}

function metaSubmissionProblem() {
  if (location.origin !== "https://business.facebook.com") return null;
  const messages = [
    ...document.querySelectorAll(
      '[role="alert"],[role="status"],[role="dialog"],[aria-live]',
    ),
  ].filter(
    (node) =>
      node.getClientRects().length && !node.closest("[aria-hidden=true]"),
  );
  const text = messages.map((node) => node.innerText || "").join(" ");
  if (
    /elimina tu enlace para terminar de publicar|remove your link to finish publishing/i.test(
      text,
    )
  ) {
    return "link-limit";
  }
  if (
    /se requiere verificaci[oó]n|verification required|verify your identity|verifica tu identidad|nuevo dispositivo o ubicaci[oó]n/i.test(
      text,
    )
  ) {
    return "verification-required";
  }
  if (
    /no se pudo publicar|couldn.t publish|failed to publish|publicaci[oó]n no publicada/i.test(
      text,
    )
  ) {
    return "posting-rejected";
  }
  if (
    /no se pudo (subir|cargar)|unable to upload|upload failed|formato no (compatible|admitido)/i.test(
      text,
    )
  ) {
    return "upload-rejected";
  }
  return null;
}

function zipPhoto(bytes, index) {
  const name = Buffer.from("veca-foto-" + (index + 1) + ".jpg");
  const local = Buffer.alloc(30);
  const central = Buffer.alloc(46);
  const end = Buffer.alloc(22);
  const crc = crc32(bytes);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]).toString(
    "base64",
  );
}

function convertPhoto(uri, square, done) {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const scale = square
      ? Math.min(1000 / image.width, 1000 / image.height)
      : Math.min(1440 / image.width, 1440 / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    canvas.width = square ? 1080 : width;
    canvas.height = square ? 1080 : height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    done(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
  };
  image.onerror = () => done(null);
  image.src = uri;
}

function unreadConversations(platform, inboxUrl) {
  const base = new URL(inboxUrl);
  if (location.origin !== base.origin) return [];
  if (!location.pathname.startsWith(base.pathname.replace(/\/$/, "")))
    return [];
  for (const [key, value] of base.searchParams)
    if (new URLSearchParams(location.search).get(key) !== value) return [];
  const seen = new Map();
  for (const a of document.querySelectorAll("a[href]")) {
    if (!a.getClientRects().length || a.closest("[aria-hidden=true]")) continue;
    const url = new URL(a.href, location.href);
    if (url.origin !== base.origin) continue;
    let id;
    if (platform === "instagram")
      id = url.pathname.match(/^\/direct\/t\/([0-9]+)\/?$/)?.[1];
    if (
      platform === "facebook" &&
      url.pathname.startsWith(base.pathname) &&
      url.searchParams.get("asset_id") === base.searchParams.get("asset_id")
    )
      id = url.searchParams.get("selected_item_id");
    if (platform === "linkedin" && url.pathname.startsWith(base.pathname))
      id =
        url.searchParams.get("conversationId") ||
        url.pathname.slice(base.pathname.length).split("/")[0];
    if (!id || !/^[a-zA-Z0-9:_-]{4,120}$/.test(id)) continue;
    const signals = [
      a,
      ...a.querySelectorAll(
        "[aria-label],[title],[data-testid],[data-test-id]",
      ),
    ].flatMap((el) =>
      ["aria-label", "title", "data-testid", "data-test-id"].map(
        (key) => el.getAttribute(key) || "",
      ),
    );
    const unread = signals.some(
      (label) =>
        /\bunread\b|\bno le[ií]d[oa]\b/i.test(label) &&
        !/mark as unread|marcar como no le[ií]d/i.test(label),
    );
    if (!seen.has(id) || unread) seen.set(id, { id, url: url.href, unread });
  }
  return [...seen.values()].slice(0, 100);
}

function sentNotice(message, editor) {
  const draft = (editor.value ?? editor.innerText ?? "").trim();
  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
  return (
    draft === "" &&
    normalize(document.body?.innerText).includes(normalize(message))
  );
}

export function createSocialActions({
  driver,
  currentSession,
  targets,
  inspectPage,
}) {
  const publishChannels = new Set(
    (process.env.VECA_PUBLICATION_CHANNELS || "").split(",").filter(Boolean),
  );
  const inboxLive = process.env.VECA_INBOX_LIVE === "true";
  const secret = process.env.SOCIAL_DELIVERY_TOKEN;
  const state = new DatabaseSync("/home/node/veca-social-state.sqlite");
  state.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      channel TEXT NOT NULL,
      id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (channel, id)
    );
    CREATE TABLE IF NOT EXISTS inbox_baselines (channel TEXT PRIMARY KEY);
  `);
  const remember = state.prepare(
    "INSERT OR IGNORE INTO conversations VALUES (?, ?, ?)",
  );
  const update = state.prepare(
    "UPDATE conversations SET state = ? WHERE channel = ? AND id = ?",
  );
  const known = state.prepare(
    "SELECT 1 FROM conversations WHERE channel = ? AND id = ?",
  );
  const baseline = state.prepare(
    "INSERT OR IGNORE INTO inbox_baselines VALUES (?)",
  );

  const run = (root, fn, args = [], async = false) =>
    driver(root + "/execute/" + (async ? "async" : "sync"), "POST", {
      script: "return (" + fn.toString() + ")(...arguments);",
      args,
    });
  const at = (child, method, body) =>
    driver("/session/" + currentSession() + child, method, body);
  const open = async (url) => {
    try {
      await at("/url", "POST", { url });
    } catch (error) {
      if (error.message !== "timeout") throw error;
    }
  };
  const waitFor = async (get, timeout = 6500) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const result = await get();
      if (result) return result;
      await delay(350);
    }
    return null;
  };
  const select = (handle) => at("/window", "POST", { handle });
  async function scratch(action) {
    const previous = await at("/window");
    const { handle } = await at("/window/new", "POST", { type: "tab" });
    try {
      await select(handle);
      return await action("/session/" + currentSession());
    } finally {
      try {
        await select(handle);
        await at("/window", "DELETE");
      } finally {
        await select(previous);
      }
    }
  }
  function requireMatch(value, reason) {
    if (!value) throw Error(reason);
    return value;
  }
  async function control(
    root,
    labels,
    scope = "body",
    kind = "button",
    timeout,
  ) {
    return waitFor(
      () => run(root, matchControl, [labels, scope, kind]),
      timeout,
    );
  }
  async function click(root, labels, scope, timeout) {
    const element = await control(root, labels, scope, "button", timeout);
    if (!element) return false;
    await at("/element/" + element[elementId] + "/click", "POST", {});
    return true;
  }
  async function transfer(photos) {
    const paths = [];
    for (const [index, photo] of photos.entries()) {
      paths.push(
        await at("/se/file", "POST", {
          file: zipPhoto(Buffer.from(photo, "base64"), index),
        }),
      );
    }
    return paths;
  }
  async function upload(root, photos, scope, trace) {
    trace("media-input");
    const input = await waitFor(() => run(root, findMediaInput, [scope]));
    requireMatch(input, "media");
    trace("media-transfer");
    const paths = await transfer(photos);
    trace("media-select");
    await at("/element/" + input[elementId] + "/value", "POST", {
      text: paths.join("\n"),
    });
  }
  async function chooseMetaDestination(root, platform) {
    const chosen = platform === "instagram" ? "vecavidrios" : "Vidrios VECA";
    const other = platform === "instagram" ? "Vidrios VECA" : "vecavidrios";
    const chooser = requireMatch(
      await waitFor(() => run(root, metaDestination, ["open"])),
      "session",
    );
    const clickElement = (element) =>
      at("/element/" + element[elementId] + "/click", "POST", {});
    await clickElement(chooser);
    for (const [name, selected] of [
      [chosen, true],
      [other, false],
    ]) {
      const option = requireMatch(
        await waitFor(() => run(root, metaDestination, [name])),
        "session",
      );
      if (option.selected !== selected) await clickElement(option.element);
    }
    requireMatch(
      await waitFor(() => run(root, metaDestination, ["verified", chosen])),
      "session",
    );
    await at("/actions", "POST", {
      actions: [
        {
          type: "key",
          id: "composer-keyboard",
          actions: [
            { type: "keyDown", value: "\uE00C" },
            { type: "keyUp", value: "\uE00C" },
          ],
        },
      ],
    });
    requireMatch(
      await waitFor(() => run(root, metaDestination, ["confirmed", chosen])),
      "session",
    );
    return chosen;
  }
  async function checkInstagramAccount(root) {
    if (await run(root, metaDestination, ["linked"])) return true;
    const chooser = await run(root, metaDestination, ["open"]);
    if (!chooser) return false;
    await at("/element/" + chooser[elementId] + "/click", "POST", {});
    return Boolean(
      await waitFor(() => run(root, metaDestination, ["vecavidrios"]), 3000),
    );
  }
  async function uploadMeta(root, photos) {
    const button = requireMatch(
      await control(root, ["Añadir foto o vídeo", "Add photo or video"]),
      "media",
    );
    const paths = await transfer(photos);
    const handle = await at("/window");
    await withChrome(
      currentSession(),
      handle,
      async (send, events, sessionId) => {
        await send("Page.enable");
        await send("Page.setInterceptFileChooserDialog", { enabled: true });
        const listener = new AbortController();
        try {
          const opened = new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 6500);
            listener.signal.addEventListener(
              "abort",
              () => clearTimeout(timeout),
              { once: true },
            );
            events.addEventListener(
              "Page.fileChooserOpened",
              ({ detail }) => {
                if (detail.sessionId === sessionId)
                  resolve(detail.params.backendNodeId);
              },
              { signal: listener.signal },
            );
          });
          await at("/element/" + button[elementId] + "/click", "POST", {});
          const backendNodeId = requireMatch(await opened, "media");
          await send("DOM.setFileInputFiles", { backendNodeId, files: paths });
        } finally {
          listener.abort();
          await send("Page.setInterceptFileChooserDialog", { enabled: false });
        }
      },
    );
  }
  async function setText(
    root,
    labels,
    scope,
    value,
    trace = () => {},
    native = false,
  ) {
    trace("caption-field");
    const editor = requireMatch(
      await control(root, labels, scope, "editor"),
      "editor",
    );
    trace("caption-input");
    if (native) {
      const keys = value.replace(/[\uE000-\uE05D]/g, "");
      await at("/element/" + editor[elementId] + "/click", "POST", {});
      await at("/element/" + editor[elementId] + "/value", "POST", {
        text: keys,
      });
      const updated = requireMatch(
        await control(root, labels, scope, "editor"),
        "editor",
      );
      requireMatch(await run(root, hasText, [updated, keys]), "editor");
      return updated;
    } else {
      await run(root, enterText, [editor, value]);
      requireMatch(await run(root, hasText, [editor, value]), "editor");
    }
    return editor;
  }
  async function assertPage(root, url, signals) {
    const allowed = await waitFor(
      async () => (await run(root, inspectPage, [url, signals])) === "verified",
    );
    requireMatch(allowed, "session");
  }
  async function call(path, body) {
    if (!secret) throw Error("delivery_auth");
    const res = await fetch(api + "/integrations/social/" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw Error("delivery_api");
    return res.json();
  }
  async function fileFor(root, cover, square) {
    const url = new URL(cover);
    const sample = composerSamples.includes(url.href);
    if (
      !sample &&
      (url.origin !== api || !/^\/media\/[a-f0-9]{24}$/.test(url.pathname))
    )
      throw Error("media");
    const fetched = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (
      !fetched.ok ||
      !/^image\/(jpeg|png|webp)/i.test(
        fetched.headers.get("content-type") || "",
      )
    )
      throw Error("media");
    const bytes = Buffer.from(await fetched.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Error("media");
    const jpeg = await run(
      root,
      convertPhoto,
      [
        "data:" +
          fetched.headers.get("content-type") +
          ";base64," +
          bytes.toString("base64"),
        square,
      ],
      true,
    );
    if (!jpeg) throw Error("media");
    return jpeg;
  }
  async function prepare(root, platform, url, signals, job, trace = () => {}) {
    trace("cover");
    const urls = job.images?.length ? job.images : [job.cover];
    const photos = [];
    for (const source of urls)
      photos.push(await fileFor(root, source, platform === "instagram"));
    trace("account");
    await open(url);
    await assertPage(root, url, signals);
    const meta = platform === "instagram" || platform === "facebook";
    const caption = publicationCaption(job, platform);
    const dialog = '[role="dialog"]';
    let photo;
    let destination;
    const checkPhoto = async () => {
      trace("photo-preview");
      photo = requireMatch(
        await waitFor(
          () =>
            meta
              ? run(root, metaPhotoPreview, [photos.length])
              : run(root, photoPreview, [dialog, photos.length]),
          meta ? 15000 : 8500,
        ),
        "media",
      );
    };
    if (meta) {
      trace("meta-destination");
      destination = await chooseMetaDestination(root, platform);
      trace("upload");
      await uploadMeta(root, photos);
      await checkPhoto();
      trace("caption");
      await setText(
        root,
        [
          "Escribe el texto que quieras incluir en el cuadro de diálogo.",
          "Enter the text you want to include in the dialog box.",
        ],
        "body",
        job.caption ? caption : caption.replace(/\s+/g, " "),
        trace,
        true,
      );
    } else {
      await open(url.replace(/dashboard\/$/, "page-posts/published/"));
      trace("open-editor");
      requireMatch(
        await click(root, [
          "Crear publicación",
          "Create post",
          "Iniciar publicación",
          "Start a post",
        ]),
        "editor",
      );
      trace("add-media");
      if (!(await waitFor(() => run(root, findMediaInput, [dialog]), 1200)))
        requireMatch(
          await click(
            root,
            [
              "Añadir contenido",
              "Add content",
              "Añadir contenido multimedia",
              "Añadir una foto",
              "Añadir foto",
              "Add media",
              "Add a photo",
              "Add photo",
            ],
            dialog,
          ),
          "editor",
        );
      if (!(await waitFor(() => run(root, findMediaInput, [dialog]), 2500)))
        await click(root, [
          "Añadir una foto",
          "Subir una foto",
          "Subir imágenes",
          "Foto",
          "Add a photo",
          "Upload photos",
          "Photo",
        ]);
      trace("upload");
      await upload(root, photos, dialog, trace);
      await checkPhoto();
      await click(root, ["Siguiente", "Next", "Hecho", "Done"], dialog, 3500);
      trace("caption");
      await setText(
        root,
        [
          "Editor de texto para crear contenido",
          "Text editor for creating content",
        ],
        dialog,
        caption,
        trace,
      );
    }
    trace("submit-preview");
    return {
      submit: requireMatch(
        await control(
          root,
          meta ? ["Publicar", "Publish"] : submitLabels,
          meta ? "body" : dialog,
        ),
        "editor",
      ),
      photo,
      destination,
    };
  }

  async function publish() {
    if (!publishChannels.size) return { mode: "disabled", deliveries: [] };
    const results = [];
    for (const [name, url, signals] of targets.publications) {
      const channel = network[name];
      if (!publishChannels.has(channel)) {
        results.push({ channel, status: "disabled" });
        continue;
      }
      const { job } = await call(channel + "/claim");
      if (!job) {
        results.push({ channel, status: "idle" });
        continue;
      }
      let submitted = false;
      let outcome = "review";
      let reason = "confirmation";
      let signal = "";
      try {
        const confirmed = await scratch(async (root) => {
          const { submit, destination } = await prepare(
            root,
            channel,
            url,
            signals,
            job,
          );
          const stillReady = await call(channel + "/" + job.id + "/check", {
            claim: job.claim,
          });
          requireMatch(stillReady.ready, "withdrawn");
          if (destination) {
            requireMatch(
              await run(root, metaDestination, ["confirmed", destination]),
              "session",
            );
            requireMatch(await run(root, metaPhotoPreview), "media");
          }
          submitted = true;
          await at("/element/" + submit[elementId] + "/click", "POST", {});
          const notice = await waitFor(async () => {
            if (await run(root, publishedNotice, [channel])) return "published";
            return destination ? run(root, metaSubmissionProblem) : null;
          }, 12000);
          if (notice && notice !== "published") {
            signal = notice;
            return false;
          }
          if (!destination) return notice === "published";
          await open(
            "https://business.facebook.com/latest/posts/published_posts/?asset_id=103191075272076",
          );
          const inHistory = await waitFor(
            () =>
              run(root, metaPublishedProject, [
                channel,
                publicationCaption(job, channel),
                job.url,
              ]),
            18000,
          );
          if (inHistory) signal = "meta-history";
          else if (notice === "published") signal = "published-notice";
          return inHistory || notice === "published";
        });
        if (confirmed) {
          outcome = "published";
          reason = "";
        } else if (signal === "verification-required") {
          reason = "session";
        } else if (signal === "upload-rejected") {
          reason = "media";
        } else if (signal === "posting-rejected" || signal === "link-limit") {
          reason = "editor";
        }
      } catch (error) {
        if (!submitted) {
          outcome =
            error.message === "withdrawn" ||
            (error.message === "media" && job.images?.length > 10)
              ? "review"
              : "retry";
          reason = ["session", "editor", "media", "withdrawn"].includes(
            error.message,
          )
            ? error.message
            : "editor";
        }
      }
      await call(channel + "/" + job.id + "/complete", {
        claim: job.claim,
        outcome,
        reason,
      });
      results.push({
        channel,
        status: outcome,
        reason,
        ...(signal && { signal }),
      });
    }
    return { mode: "live", deliveries: results };
  }

  async function inbox() {
    const results = [];
    for (const [name, url, signals] of targets.inboxes) {
      const channel = network[name];
      try {
        results.push(
          await scratch(async (root) => {
            await open(url);
            await assertPage(root, url, signals);
            const conversations = await run(root, unreadConversations, [
              channel,
              url,
            ]);
            const pending = conversations.filter(
              (c) => c.unread && !known.get(channel, c.id),
            );
            let replied = 0;
            let review = 0;
            if (inboxLive) {
              const form = website + "/contacto/" + channel + "/";
              const live = await fetch(form, {
                redirect: "error",
                signal: AbortSignal.timeout(8000),
              });
              if (!live.ok) throw Error("form");
              if (baseline.run(channel).changes) {
                for (const item of conversations)
                  remember.run(channel, item.id, "baseline");
                return {
                  channel,
                  baseline: conversations.length,
                  unread: pending.length,
                  replied,
                  review,
                };
              }
              const message =
                "¡Hola! Gracias por escribir a Vidrios VECA. Déjanos tu nombre, teléfono y correo, y cuéntanos qué te gustaría instalar, reparar o renovar. Completa este formulario y te contactaremos: " +
                form;
              for (const item of pending.slice(0, 3)) {
                if (!remember.run(channel, item.id, "processing").changes)
                  continue;
                try {
                  await open(item.url);
                  const sameThread = await run(
                    root,
                    (expected) =>
                      location.href.split("#")[0] === expected.split("#")[0],
                    [item.url],
                  );
                  requireMatch(sameThread, "thread");
                  const editor = await setText(
                    root,
                    [
                      "Message…",
                      "Message...",
                      "Message",
                      "Mensaje",
                      "Mensaje…",
                      "Escribe un mensaje…",
                      "Escribe un mensaje...",
                      "Write a message...",
                      "Write a message…",
                      "Escribe tu mensaje",
                      "Write a message",
                      "Escribe un mensaje",
                    ],
                    "body",
                    message,
                  );
                  requireMatch(
                    await click(root, [
                      "Enviar",
                      "Send",
                      "Enviar mensaje",
                      "Send message",
                    ]),
                    "send",
                  );
                  const sent = await waitFor(
                    () => run(root, sentNotice, [message, editor]),
                    5500,
                  );
                  update.run(sent ? "replied" : "review", channel, item.id);
                  if (sent) replied++;
                  else review++;
                } catch {
                  update.run("review", channel, item.id);
                  review++;
                }
              }
            }
            return { channel, unread: pending.length, replied, review };
          }),
        );
      } catch (error) {
        results.push({
          channel,
          status:
            error.message === "form"
              ? "form_unavailable"
              : "session_unverified",
        });
      }
    }
    return { mode: inboxLive ? "live" : "preview", inboxes: results };
  }

  async function verifyComposers(onlyChannel) {
    const test = {
      title: "Vista previa técnica · Vidrios VECA",
      description: "Comprobación de texto y portada.",
      caption:
        "Vista previa técnica · Vidrios VECA\nComprobación de texto y dos fotos.",
      url: website + "/",
      cover: composerSamples[0],
      images: composerSamples,
    };
    const composers = [];
    for (const [name, url, signals] of targets.publications) {
      const channel = network[name];
      if (onlyChannel && channel !== onlyChannel) continue;
      let stage = "open";
      let diagnostics;
      try {
        const prepared = await scratch(async (root) => {
          try {
            return await prepare(root, channel, url, signals, test, (value) => {
              stage = value;
            });
          } catch (error) {
            diagnostics = await run(root, composerDiagnostics, [channel]).catch(
              () => undefined,
            );
            throw error;
          }
        });
        composers.push({ channel, status: "prepared", photo: prepared.photo });
      } catch (error) {
        composers.push({
          channel,
          stage,
          diagnostics,
          ...(channel === "instagram" &&
            [
              "stale element reference",
              "element not interactable",
              "element click intercepted",
              "javascript error",
              "timeout",
            ].includes(error.message) && { reason: error.message }),
          status: ["session", "media", "editor"].includes(error.message)
            ? error.message
            : "unavailable",
        });
      }
    }
    return { composers };
  }
  async function reportHealth(group, accounts) {
    return call("health", {
      group,
      accounts: accounts.map(({ platform, status }) => ({
        channel: network[platform],
        status,
      })),
    });
  }
  async function relayPublications(status) {
    if (!secret) return;
    const signature = createHmac("sha256", secret)
      .update("veca:n8n:publication:v1")
      .digest("hex");
    for (;;) {
      const controller = new AbortController();
      let watchdog = setTimeout(() => controller.abort(), 35000);
      try {
        const connection = await fetch(
          api + "/integrations/social/publication-events",
          {
            headers: {
              Authorization: "Bearer " + secret,
              Accept: "text/event-stream",
            },
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (
          !connection.ok ||
          !connection.headers
            .get("content-type")
            ?.startsWith("text/event-stream")
        )
          throw Error("event_stream");
        status.connected = true;
        let buffer = "";
        for await (const chunk of connection.body.pipeThrough(
          new TextDecoderStream(),
        )) {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => controller.abort(), 35000);
          buffer += chunk;
          if (buffer.length > 65536) throw Error("event_buffer");
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop();
          if (
            !frames.some((frame) =>
              frame.split(/\r?\n/).includes("event: publication"),
            )
          )
            continue;
          status.receivedAt = new Date().toISOString();
          const hook = await fetch(
            "http://n8n:5678/webhook/veca-publicacion-obra",
            {
              method: "POST",
              headers: {
                "X-Veca-Publication": signature,
                "Content-Type": "application/json",
              },
              body: "{}",
              signal: AbortSignal.timeout(8000),
              redirect: "error",
            },
          );
          if (hook.ok) status.forwardedAt = new Date().toISOString();
          await hook.body?.cancel();
        }
      } catch {
        // The scheduled workflow still processes any queued work during a disconnect.
      } finally {
        clearTimeout(watchdog);
        controller.abort();
        status.connected = false;
      }
      await delay(3500);
    }
  }
  return {
    publish,
    inbox,
    verifyComposers,
    checkInstagramAccount,
    reportHealth,
    relayPublications,
  };
}
