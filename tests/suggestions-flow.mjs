import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
const base = "http://localhost:4400",
  path = "/admin/suggestions";
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa"),
  role = "qa-forum-" + randomUUID();
const ids = Array.from({ length: 4 }, () => new ObjectId());
const topicIds = [],
  commentIds = [];
let cookie = "",
  csrf = "";
async function call(route, method = "GET", data, token = csrf) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      Cookie: cookie,
      "X-Veca-Csrf": token,
      "Content-Type": "application/json",
    },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  const body = await r.json();
  return { status: r.status, body };
}
async function login(username) {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3300",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password: "Local-only-visual-test-2026!",
    }),
  });
  assert.equal(r.status, 201);
  cookie = r.headers.get("set-cookie").split(";")[0];
  csrf = (await r.json()).csrf;
}
try {
  assert.equal((await call(path)).status, 401);
  const admin = await db.collection("users").findOne({ username: "admin" });
  await db
    .collection("roles")
    .insertOne({ id: role, name: "Equipo QA", permissions: [], revision: 1 });
  await db.collection("users").insertMany(
    ids.map((_id, index) => ({
      _id,
      username: `${role}-${index}`,
      name: `Empleado QA ${index}`,
      role,
      passwordHash: admin.passwordHash,
      status: index === 2 ? "pending" : "active",
      emailVerified: true,
    })),
  );
  const newTopic = {
    id: randomUUID(),
    title: "Encontrar pedidos por proveedor",
    body: "Nos ayudaría buscar los pedidos por nombre del proveedor al recibir materiales.",
    section: "inventory",
  };
  topicIds.push(newTopic.id);
  await login(`${role}-2`);
  assert.equal((await call(path)).status, 403);
  assert.equal((await call(path, "POST", newTopic)).status, 403);
  await login(`${role}-3`);
  await db
    .collection("users")
    .updateOne({ _id: ids[3] }, { $set: { emailVerified: false } });
  assert.equal((await call(path)).status, 403);
  await login(`${role}-0`);
  assert.equal(
    (await call(path)).status,
    200,
    "Active staff need no additional module permission",
  );
  assert.equal((await call(path, "POST", newTopic, "invalid")).status, 403);
  assert.equal(
    (
      await call(path, "POST", {
        ...newTopic,
        author: { id: String(ids[1]), name: "Fake" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(path, "POST", { ...newTopic, status: "implemented" })).status,
    400,
  );
  assert.equal(
    (await call(path, "POST", { ...newTopic, body: "x".repeat(3001) })).status,
    400,
  );
  const made = await call(path, "POST", newTopic);
  assert.equal(made.status, 201, JSON.stringify(made));
  assert.equal(made.body.author.id, String(ids[0]));
  assert.equal(made.body.status, "open");
  assert.equal((await call(path, "POST", newTopic)).body.id, newTopic.id);
  assert.equal(
    await db.collection("suggestions").countDocuments({ _id: newTopic.id }),
    1,
  );
  assert.equal(
    (await call(path, "POST", { ...newTopic, title: "Otro título" })).status,
    409,
  );
  await login(`${role}-1`);
  assert.equal(
    (await call(`${path}/${newTopic.id}`)).status,
    200,
    "All staff can read the forum",
  );
  assert.equal(
    (
      await call(`${path}/${newTopic.id}`, "PUT", {
        title: newTopic.title,
        body: newTopic.body,
        section: "inventory",
        version: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`${path}/${newTopic.id}/status`, "PUT", {
        status: "implemented",
        version: 1,
      })
    ).status,
    403,
  );
  const comment = {
    id: randomUUID(),
    body: "También sería útil poder buscar por el número de factura.",
  };
  commentIds.push(comment.id);
  assert.equal(
    (await call(`${path}/${randomUUID()}/comments`, "POST", comment)).status,
    404,
  );
  const posted = await call(`${path}/${newTopic.id}/comments`, "POST", comment);
  assert.equal(posted.status, 201, JSON.stringify(posted));
  assert.equal(posted.body.author.id, String(ids[1]));
  assert.equal(
    (await call(`${path}/${newTopic.id}/comments`, "POST", comment)).status,
    201,
  );
  assert.equal(
    (
      await call(`${path}/${newTopic.id}/comments`, "POST", {
        ...comment,
        body: "Otra idea",
      })
    ).status,
    409,
  );
  let detail = await call(`${path}/${newTopic.id}`);
  assert.equal(detail.body.commentCount, 1);
  assert.equal(detail.body.comments.length, 1);
  const list = await call(`${path}?section=inventory&search=proveedor`);
  assert.ok(
    list.body.items.some((t) => t.id === newTopic.id && t.commentCount === 1),
  );
  assert.equal(
    (await call(`${path}?search=%5B.*`)).body.items.length,
    0,
    "Search treats regex characters as literal text",
  );
  assert.equal((await call(`${path}?section=invalid`)).status, 400);
  await login(`${role}-0`);
  const edit = {
    title: "Encontrar pedidos de forma rápida",
    body: newTopic.body,
    section: "inventory",
    version: 1,
  };
  assert.equal((await call(`${path}/${newTopic.id}`, "PUT", edit)).status, 200);
  assert.equal((await call(`${path}/${newTopic.id}`, "PUT", edit)).status, 409);
  const staffSession = { cookie, csrf };
  await login("admin");
  const changed = await call(`${path}/${newTopic.id}/status`, "PUT", {
    status: "reviewing",
    version: 2,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal(changed.body.status, "reviewing");
  assert.equal(
    (
      await call(`${path}/${newTopic.id}/status`, "PUT", {
        status: "implemented",
        version: 2,
      })
    ).status,
    409,
  );
  const now = new Date().toISOString();
  const fixtures = Array.from({ length: 21 }, (_, i) => {
    const id = randomUUID();
    topicIds.push(id);
    return { ...made.body, _id: id, title: `Foro QA ${i}`, id: undefined };
  });
  await db
    .collection("suggestions")
    .insertMany(fixtures.map(({ id, ...doc }) => doc));
  const first = await call(`${path}?page=1`),
    second = await call(`${path}?page=2`);
  assert.equal(first.body.items.length, 20);
  assert.equal(first.body.hasMore, true);
  assert.equal(second.body.items.length, 2);
  assert.equal(
    new Set([...first.body.items, ...second.body.items].map((t) => t.id)).size,
    22,
  );
  const replies = Array.from({ length: 31 }, (_, i) => {
    const id = randomUUID();
    commentIds.push(id);
    return {
      _id: id,
      suggestionId: newTopic.id,
      body: `Comentario QA ${i}`,
      author: { id: String(ids[0]), name: "Empleado QA" },
      createdAt: now,
    };
  });
  await db.collection("suggestion_comments").insertMany(replies);
  detail = await call(`${path}/${newTopic.id}?page=2`);
  assert.equal(detail.body.comments.length, 2);
  assert.equal(detail.body.commentCount, 32);
  assert.equal(detail.body.hasMoreComments, false);
  await db
    .collection("users")
    .updateOne({ _id: ids[0] }, { $set: { status: "suspended", revision: 2 } });
  cookie = staffSession.cookie;
  csrf = staffSession.csrf;
  assert.ok(
    [401, 403].includes((await call(path)).status),
    "Suspended users lose forum access",
  );
  console.log(
    "PASS forum: active staff participation, pending/unverified isolation, CSRF, author identity, immutable fields, idempotent topics/comments, own edits, admin-only status, conflicts, literal search and pagination.",
  );
} finally {
  await db
    .collection("suggestion_comments")
    .deleteMany({ _id: { $in: commentIds } });
  await db.collection("suggestions").deleteMany({ _id: { $in: topicIds } });
  await db.collection("sessions").deleteMany({ userId: { $in: ids } });
  await db.collection("users").deleteMany({ _id: { $in: ids } });
  await db.collection("roles").deleteOne({ id: role });
  await client.close();
}
