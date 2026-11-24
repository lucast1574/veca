import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import sharp from "sharp";
const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Gallery fixtures are local-only");
let cookie = "",
  csrf = "";
async function req(path, method = "GET", body, credentials = true) {
  const headers = {
    Origin: "http://localhost:3300",
    ...(credentials ? { Cookie: cookie, "X-Veca-Csrf": csrf } : {}),
  };
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, {
    method,
    headers,
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  const bytes = await res.arrayBuffer();
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    data = bytes;
  }
  return { status: res.status, body: data, headers: res.headers };
}
async function login(username = "admin") {
  const r = await req("/auth/login", "POST", {
    username,
    password: "Local-only-visual-test-2026!",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  cookie = r.headers.get("set-cookie").split(";")[0];
  csrf = r.body.csrf;
}
async function mobileLogin(username) {
  const r = await req(
    "/mobile/auth/login",
    "POST",
    {
      username,
      password: "Local-only-visual-test-2026!",
    },
    false,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.token);
  return r.body.token;
}
function mobileGet(path, token) {
  return fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
function galleryUpload(file, { name, category, submissionId = randomUUID() }) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file]), "foto.webp");
  form.append("name", name);
  form.append("category", category);
  form.append("submissionId", submissionId);
  return form;
}
function mobileUpload(token, form) {
  return fetch(base + "/mobile/photos", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
}
const invalidGoogle = await req(
  "/mobile/auth/google/native",
  "POST",
  {
    idToken: "not-a-valid-firebase-id-token",
  },
  false,
);
assert.equal(invalidGoogle.status, 401);
await login();
const leadResult = await req("/admin/crm/leads", "POST", {
  name: "Cliente local de galería",
  email: "galeria@example.test",
  phone: "908917621",
  district: "San Luis",
  requestType: "premium",
  idea: "Una mampara con detalles para revisar de forma privada.",
  submissionId: randomUUID(),
});
assert.equal(leadResult.status, 201, JSON.stringify(leadResult.body));
const lead = { id: leadResult.body.reference };
async function upload({ pdf = false, tags, sharing } = {}) {
  const form = new FormData();
  const image = pdf
    ? Buffer.from("%PDF-1.4\n%%EOF")
    : await sharp("assets/mamparas.webp").resize(400).webp().toBuffer();
  form.append(
    "file",
    new Blob([image], { type: pdf ? "application/pdf" : "image/webp" }),
    pdf ? "contrato.pdf" : "mampara.webp",
  );
  form.append(
    "caption",
    pdf ? "Contrato privado de prueba" : "Detalle de mampara de prueba",
  );
  if (tags !== undefined) form.append("tags", JSON.stringify(tags));
  if (sharing !== undefined) form.append("sharing", sharing);
  return req(`/admin/crm/leads/${lead.id}/files`, "POST", form);
}
let r = await upload();
assert.equal(r.status, 201);
const internal = r.body;
assert.equal(internal.sharing, "internal");
assert.deepEqual(internal.tags, []);
r = await upload({ tags: ["Resultado", "Detalle"], sharing: "clients" });
assert.equal(r.status, 201);
const approved = r.body;
r = await upload({ pdf: true, tags: ["Resultado"], sharing: "clients" });
assert.equal(r.status, 201);
const pdf = r.body;
assert.equal(pdf.sharing, "internal");
assert.deepEqual(pdf.tags, []);
assert.equal((await upload({ tags: ["Etiqueta inventada"] })).status, 400);
assert.equal((await upload({ sharing: "public" })).status, 400);
const gallery = "/admin/gallery/photos";
const leadGallery = gallery + "?source=lead";
assert.equal((await req(gallery, "GET", null, false)).status, 401);
r = await req(leadGallery);
assert.equal(r.status, 200);
assert.match(r.headers.get("cache-control"), /no-store/);
assert.equal(r.body.total, 2);
assert.ok(
  r.body.items.every(
    (p) =>
      p.type === "photo" && !p.key && !p.mime && !p.lead.phone && !p.lead.email,
  ),
);
assert.ok(
  r.body.items.every(
    (p) => p.lead.id === lead.id && p.lead.requestType === "premium",
  ),
);
assert.equal(
  (
    await req(
      gallery +
        "?sharing=clients&tag=Resultado&requestType=premium&segment=high&search=San%20Luis",
    )
  ).body.total,
  1,
);
assert.equal((await req(gallery + "?sharing=internal")).body.total, 1);
assert.equal((await req(gallery + "?search=.*")).body.total, 0);
assert.equal((await req(gallery + "?page=-1")).status, 400);
assert.equal((await req(gallery + "?tag=Inventada")).status, 400);
for (const photo of [internal, approved]) {
  assert.equal(
    (await req(`${gallery}/${photo.id}`, "GET", null, false)).status,
    401,
  );
  assert.equal((await req(photo.url, "GET", null, false)).status, 401);
  r = await req(`${gallery}/${photo.id}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /private, no-store/);
  assert.ok(r.body.byteLength > 100);
  assert.equal(
    (await req(`/media/${photo.id}`, "GET", null, false)).status,
    404,
  );
}
assert.equal((await req(`${gallery}/${pdf.id}`)).status, 404);
const originalCsrf = csrf;
csrf = "invalid";
assert.equal(
  (
    await req(`${gallery}/${internal.id}`, "PUT", {
      revision: internal.revision,
      caption: "Cambio",
      tags: [],
      sharing: "clients",
    })
  ).status,
  403,
);
csrf = originalCsrf;
const update = {
  revision: internal.revision,
  caption: "Resultado autorizado para mostrar",
  tags: ["Resultado"],
  sharing: "clients",
};
r = await req(`${gallery}/${internal.id}`, "PUT", update);
assert.equal(r.status, 200);
assert.equal(r.body.revision, internal.revision + 1);
assert.equal(
  (await req(`${gallery}/${internal.id}`, "PUT", update)).status,
  409,
);
assert.equal(
  (
    await req(`${gallery}/${internal.id}`, "PUT", {
      ...update,
      revision: r.body.revision,
      published: true,
    })
  ).status,
  400,
);
assert.equal(
  (await req(`${gallery}/${internal.id}`, "GET", null, false)).status,
  401,
);
const mongo = new MongoClient("mongodb://127.0.0.1:27099");
await mongo.connect();
try {
  const db = mongo.db("veca_qa");
  const files = db.collection("crm_files");
  await files.updateOne(
    { _id: new ObjectId(internal.id) },
    { $unset: { tags: "", sharing: "", revision: "" } },
  );
  r = await req(gallery + "?sharing=internal");
  assert.equal(r.body.total, 1);
  assert.deepEqual(r.body.items[0].tags, []);
  assert.equal(r.body.items[0].revision, 0);
  assert.equal(
    (
      await req(`${gallery}/${internal.id}`, "PUT", {
        revision: 0,
        caption: "Foto antigua conservada",
        tags: ["Antes"],
        sharing: "internal",
      })
    ).status,
    200,
  );
  await db
    .collection("crm_leads")
    .updateOne(
      { _id: new ObjectId(lead.id) },
      { $set: { stage: "completed" } },
    );
  assert.equal((await req(gallery + "?stage=completed")).body.total, 2);
  const source = await files.findOne({ _id: new ObjectId(approved.id) });
  const ids = Array.from({ length: 37 }, () => new ObjectId());
  await files.insertMany(
    ids.map((id, i) => ({
      ...source,
      _id: id,
      caption: "Paginación local " + i,
    })),
  );
  const first = (await req(leadGallery)).body,
    second = (await req(leadGallery + "&page=2")).body;
  assert.equal(first.total, 39);
  assert.equal(first.items.length, 36);
  assert.equal(second.items.length, 3);
  assert.equal(first.pages, 2);
  assert.ok(!second.items.some((p) => first.items.some((x) => x.id === p.id)));
  await files.deleteMany({ _id: { $in: ids } });
  const previousTotal = (await req(gallery)).body.total;

  const images = [];
  for (const name of [
    "Mampara lateral",
    "Portada de mampara",
    "Detalle sin publicar",
  ]) {
    const form = new FormData();
    const photo = await sharp("assets/mamparas.webp")
      .resize(500)
      .webp()
      .toBuffer();
    form.append(
      "file",
      new Blob([photo], { type: "image/webp" }),
      "mampara.webp",
    );
    const uploaded = await req("/media", "POST", form);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    images.push({ ...uploaded.body, alt: name });
  }
  const projectInput = {
    title: "Mampara de galería en San Luis",
    category: "interiores",
    location: "San Luis",
    tags: ["Mamparas"],
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Una mampara instalada en San Luis con perfilería de aluminio y vidrio templado.",
            },
          ],
        },
      ],
    },
    images: images.slice(0, 2),
    coverId: images[1].id,
  };
  r = await req("/admin/projects", "POST", projectInput);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const projectId = r.body.id;
  r = await req(`/admin/projects/${projectId}/publish`, "POST", {
    version: r.body.version,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await req(`/admin/projects/${projectId}`, "PUT", {
    ...projectInput,
    images,
    version: r.body.version,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const projectGallery =
    gallery +
    "?source=publication&search=" +
    encodeURIComponent(projectInput.title);
  r = await req(projectGallery + "&category=interiores");
  assert.equal(r.body.total, 3);
  const mobileProjects = projectGallery.replace("/admin/gallery", "/mobile");
  const adminToken = await mobileLogin("admin");
  const mobileAdmin = await mobileGet(mobileProjects, adminToken);
  assert.equal(mobileAdmin.status, 200);
  const mobileProjectItems = (await mobileAdmin.json()).items;
  assert.deepEqual(
    mobileProjectItems.map((photo) => photo.id),
    r.body.items.map((photo) => photo.id),
  );
  assert.ok(
    mobileProjectItems.every((photo) =>
      photo.subtitle.includes(projectInput.title),
    ),
  );
  for (const photo of mobileProjectItems) {
    const binary = await mobileGet(photo.url, adminToken);
    assert.equal(binary.status, 200);
    assert.equal(binary.headers.get("content-type"), "image/webp");
    assert.ok((await binary.arrayBuffer()).byteLength > 0);
    assert.equal((await mobileGet(photo.url)).status, 401);
  }
  assert.equal(
    r.body.items.filter((photo) => photo.publication.status === "draft").length,
    1,
  );
  r = await req(projectGallery + "&status=published");
  assert.deepEqual(
    r.body.items.map((photo) => photo.alt),
    ["Portada de mampara", "Mampara lateral"],
  );
  r = await req(leadGallery);
  assert.equal(r.body.total, 2);
  assert.ok(r.body.items.every((photo) => photo.source === "lead"));
  assert.equal((await req(gallery)).body.total, previousTotal + 3);
  r = await req(leadGallery + "&sort=oldest");
  assert.equal(r.body.items[0].id, internal.id);
  assert.equal((await req(new URL(images[2].url).pathname)).status, 200);

  await db.collection("roles").insertOne({
    id: "gallery-test-only",
    name: "Galería de prueba",
    permissions: ["gallery"],
    revision: 1,
  });
  const admin = await db.collection("users").findOne({ username: "admin" });
  await db.collection("users").insertOne({
    _id: new ObjectId(),
    username: "gallery-local-test",
    name: "Prueba galería",
    passwordHash: admin.passwordHash,
    emailVerified: true,
    role: "gallery-test-only",
    status: "active",
  });
  await login("gallery-local-test");
  assert.equal((await req(gallery)).status, 200);
  const allowedProjects = (await req(projectGallery)).body;
  assert.equal(allowedProjects.total, 2);
  const galleryToken = await mobileLogin("gallery-local-test");
  const mobileLimited = await mobileGet(mobileProjects, galleryToken);
  assert.equal(mobileLimited.status, 200);
  assert.deepEqual(
    (await mobileLimited.json()).items.map((photo) => photo.id),
    allowedProjects.items.map((photo) => photo.id),
  );
  assert.equal(
    (await mobileGet(`/mobile/media/${images[2].id}`, galleryToken)).status,
    403,
  );
  assert.equal((await req(projectGallery + "&status=draft")).body.total, 0);
  assert.equal((await req(new URL(images[2].url).pathname)).status, 403);
  assert.equal((await req(`${gallery}/${approved.id}`)).status, 200);
  assert.equal((await req(approved.url)).status, 403);
  assert.equal((await req(pdf.url)).status, 403);
  assert.equal((await req("/admin/crm/leads")).status, 403);
  assert.equal((await req(`${gallery}/${pdf.id}`)).status, 404);
  const image = await sharp("assets/mamparas.webp")
    .resize(400)
    .avif()
    .toBuffer();
  const metadata = {
    name: "  Mampara del taller  ",
    category: "interiores",
    submissionId: randomUUID(),
  };
  const form = () => galleryUpload(image, metadata);
  assert.equal((await req(gallery, "POST", form(), false)).status, 401);
  assert.equal((await mobileUpload(null, form())).status, 401);
  const previousCsrf = csrf;
  csrf = "invalid";
  assert.equal((await req(gallery, "POST", form())).status, 403);
  csrf = previousCsrf;
  for (const invalid of [
    galleryUpload(image, { ...metadata, category: "inventada" }),
    galleryUpload(image, { ...metadata, name: "  " }),
    galleryUpload(null, metadata),
    galleryUpload(Buffer.from("%PDF-1.4\n%%EOF"), metadata),
  ])
    assert.equal((await req(gallery, "POST", invalid)).status, 400);
  assert.equal(
    (
      await req(
        gallery,
        "POST",
        galleryUpload(Buffer.alloc(12 * 1024 * 1024 + 1), metadata),
      )
    ).status,
    413,
  );
  const uploads = await Promise.all([
    req(gallery, "POST", form()),
    req(gallery, "POST", form()),
  ]);
  assert.ok(uploads.every((item) => item.status === 201));
  const webPhoto = uploads[0].body;
  assert.deepEqual(uploads[1].body, webPhoto);
  assert.equal(webPhoto.name, metadata.name.trim());
  assert.equal(webPhoto.category, "interiores");
  assert.equal(webPhoto.source, "upload");
  assert.equal(webPhoto.uploadedBy, undefined);
  assert.equal(
    (await req(webPhoto.url)).headers.get("content-type"),
    "image/webp",
  );
  assert.equal((await req(webPhoto.url, "GET", null, false)).status, 401);
  assert.equal(
    (await req(`/media/${webPhoto.id}`, "GET", null, false)).status,
    404,
  );
  const endpoint = "/mobile/photos";
  const mobileSaved = await mobileUpload(
    galleryToken,
    galleryUpload(image, { name: "Ventana del taller", category: "viviendas" }),
  );
  assert.equal(mobileSaved.status, 201);
  const mobilePhoto = await mobileSaved.json();
  const photosSubidos = await mobileGet(
    endpoint + "?source=upload",
    galleryToken,
  );
  const mobileItems = (await photosSubidos.json()).items;
  assert.deepEqual(
    mobileItems.map(({ id }) => id).sort(),
    [webPhoto.id, mobilePhoto.id].sort(),
  );
  const mobileWebPhoto = mobileItems.find(({ id }) => id === webPhoto.id);
  assert.equal(mobileWebPhoto.subtitle, "Interiores y mamparas");
  assert.equal((await mobileGet(mobileWebPhoto.url, galleryToken)).status, 200);
  assert.equal((await mobileGet(mobileWebPhoto.url)).status, 401);
  const filteredUpload = (
    await req(gallery + "?source=upload&search=VENTANA&category=viviendas")
  ).body.items;
  assert.deepEqual(
    filteredUpload.map(({ id }) => id),
    [mobilePhoto.id],
  );
  assert.ok(
    (await req(gallery)).body.items.some(({ id }) => id === mobilePhoto.id),
  );
  const filteredMobile = await mobileGet(
    endpoint + "?source=upload&category=interiores",
    galleryToken,
  );
  assert.deepEqual(
    (await filteredMobile.json()).items.map(({ id }) => id),
    [webPhoto.id],
  );
  const activeAccount = await mobileGet("/mobile/auth/me", galleryToken);
  assert.ok(
    (await activeAccount.json()).photoCategories.some(
      ({ id }) => id === "interiores",
    ),
  );
  await db
    .collection("users")
    .updateOne(
      { username: "gallery-local-test" },
      { $set: { mobileReview: true } },
    );
  assert.equal((await mobileUpload(galleryToken, form())).status, 403);
  assert.equal((await mobileGet(mobileWebPhoto.url, galleryToken)).status, 403);
  const reviewAccount = await mobileGet("/mobile/auth/me", galleryToken);
  assert.deepEqual((await reviewAccount.json()).photoCategories, []);
  await db
    .collection("users")
    .updateOne(
      { username: "gallery-local-test" },
      { $unset: { mobileReview: "" } },
    );
  await db
    .collection("roles")
    .updateOne(
      { id: "gallery-test-only" },
      { $set: { permissions: [] }, $inc: { revision: 1 } },
    );
  assert.equal((await req(gallery)).status, 403);
  assert.equal((await mobileGet(mobileProjects, galleryToken)).status, 403);
  assert.equal((await mobileUpload(galleryToken, form())).status, 403);
  assert.equal((await req(gallery, "POST", form())).status, 403);
  assert.equal((await req(`${gallery}/${approved.id}`)).status, 403);
} finally {
  await mongo.close();
}
console.log(
  "PASS: private photo uploads in web and mobile, validation, retries, review isolation, lead and publication gallery, permissions, filters, pagination, legacy data and concurrent edits.",
);
