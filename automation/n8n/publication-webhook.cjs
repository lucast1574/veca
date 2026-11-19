const { execFileSync } = require("node:child_process");
const { createHmac, randomUUID } = require("node:crypto");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const id = "VecaSocialPub001";
const path = "veca-publicacion-obra";
const credential = {
  id: "VecaProjectHook01",
  name: "VECA · Disparador de publicación",
};
const dir = mkdtempSync(join(tmpdir(), "veca-publication-"));
const token = process.env.SOCIAL_DELIVERY_TOKEN;
const triggerName = "Al publicar una obra en VECA";

function n8n(...args) {
  return execFileSync("n8n", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 90000,
  });
}

function write(name, value) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}

let stage = "export";
let previous;
try {
  if (!token || token.length < 32) throw Error("token_missing");
  const destination = join(dir, "existing.json");
  n8n("export:workflow", "--id=" + id, "--output=" + destination);
  const [workflow] = JSON.parse(readFileSync(destination, "utf8"));
  const executor = workflow?.nodes.find(
    (node) =>
      node.parameters?.url === "http://browser-worker:8080/tick/publications",
  );
  if (workflow?.id !== id || !executor) throw Error("unexpected_workflow");
  if (!workflow.active || !workflow.activeVersionId)
    throw Error("workflow_inactive");
  if (workflow.versionId !== workflow.activeVersionId)
    throw Error("unpublished_edits");
  previous = workflow.activeVersionId;
  if (workflow.nodes.some((node) => node.type === "n8n-nodes-base.webhook")) {
    if (
      !workflow.nodes.some(
        (node) =>
          node.parameters?.path === path &&
          node.credentials?.httpHeaderAuth?.id === credential.id,
      )
    )
      throw Error("existing_webhook");
    console.log(JSON.stringify({ webhook: "already_published" }));
  } else {
    stage = "credential";
    const signature = createHmac("sha256", token)
      .update("veca:n8n:publication:v1")
      .digest("hex");
    const file = write("header.json", [
      {
        ...credential,
        type: "httpHeaderAuth",
        data: { name: "X-Veca-Publication", value: signature },
      },
    ]);
    n8n("import:credentials", "--input=" + file);

    stage = "import";
    workflow.nodes.push({
      id: randomUUID(),
      webhookId: randomUUID(),
      name: triggerName,
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 650],
      parameters: {
        httpMethod: "POST",
        path,
        authentication: "headerAuth",
        responseMode: "onReceived",
        options: {},
      },
      credentials: { httpHeaderAuth: credential },
    });
    executor.retryOnFail = true;
    executor.maxTries = 5;
    executor.waitBetweenTries = 5000;
    workflow.connections[triggerName] = {
      main: [[{ node: executor.name, type: "main", index: 0 }]],
    };
    workflow.versionId = randomUUID();
    workflow.active = false;
    workflow.activeVersionId = null;
    n8n(
      "import:workflow",
      "--activeState=false",
      "--input=" + write("publication.json", [workflow]),
    );
    stage = "publish";
    n8n("publish:workflow", "--id=" + id);
    console.log(JSON.stringify({ webhook: "published", fallback: true }));
  }
} catch (error) {
  if (previous && (stage === "import" || stage === "publish")) {
    try {
      n8n("publish:workflow", "--id=" + id, "--versionId=" + previous);
    } catch {}
  }
  const detail =
    error.status !== undefined
      ? String(error.stderr || error.stdout || "")
          .split("\n")
          .find((line) =>
            /already.*published|project.*not.*found|unknown|not.*found|conflict|permission|unrecognized/i.test(
              line,
            ),
          )
      : error.message;
  console.log(
    JSON.stringify({
      stage,
      error: detail?.slice(0, 180) || "n8n_command_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
