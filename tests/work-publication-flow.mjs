import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import sharp from "sharp";
import {
  crmLeadDefaults,
  emptyProject,
  projectInputSchema,
  formatPeruLocation,
} from "@veca/content";
const base = process.env.TEST_API_URL || "http://localhost:4400";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local-only publication fixtures");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect(),
  db = client.db("veca_qa");
const tag = "publication-" + randomUUID(),
  publisherId = new ObjectId(),
  workerId = new ObjectId(),
  workId = new ObjectId(),
  otherId = new ObjectId();
const sessions = {},
  projectIds = [],
  mediaIds = [];
async function call(
  path,
  who = "publisher",
  method = "GET",
  body,
  status = 200,
) {
  const session = sessions[who],
    form = body instanceof FormData;
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3300",
      ...(session
        ? { Cookie: session.cookie, "X-Veca-Csrf": session.csrf }
        : {}),
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = r.headers.get("content-type");
  const data = type?.includes("json") ? await r.json() : await r.arrayBuffer();
  assert.equal(
    r.status,
    status,
    `${who} ${method} ${path}: ${JSON.stringify(data)}`,
  );
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const get = async (path, who = "publisher", status = 200) =>
  (await call(path, who, "GET", undefined, status)).data;
const post = async (path, body, who = "publisher", status = 201) =>
  (await call(path, who, "POST", body, status)).data;
const put = async (path, body, status = 200) =>
  (await call(path, "publisher", "PUT", body, status)).data;
const toInput = (project) =>
  Object.fromEntries(
    Object.keys(projectInputSchema.shape).map((key) => [key, project[key]]),
  );
const root = `/admin/project-sources/works/${workId}`;
try {
  const admin = await db.collection("users").findOne({ username: "admin" });
  await db.collection("roles").insertOne({
    id: tag,
    name: "Publicaciones QA",
    permissions: ["projects", "dashboard"],
    revision: 1,
  });
  for (const [id, name, role] of [
    [publisherId, "publisher", tag],
    [workerId, "worker", "worker"],
  ])
    await db.collection("users").insertOne({
      _id: id,
      username: tag + name,
      name,
      role,
      status: "active",
      emailVerified: true,
      passwordHash: admin.passwordHash,
    });
  for (const who of ["admin", "publisher", "worker"]) {
    const result = await call(
      "/auth/login",
      null,
      "POST",
      {
        username: who === "admin" ? "admin" : tag + who,
        password: "Local-only-visual-test-2026!",
      },
      201,
    );
    sessions[who] = { cookie: result.cookie, csrf: result.data.csrf };
  }
  await db.collection("crm_leads").insertMany(
    [workId, otherId].map((_id, index) => ({
      ...crmLeadDefaults,
      _id,
      submissionId: tag + index,
      name: "Cliente privado",
      phone: "999111222",
      email: "",
      district: "San Luis",
      requestType: "home",
      idea: "Instalación de mamparas del hogar.",
      segment: "low",
      source: "manual",
      stage: index ? "execution" : "completed",
      version: 1,
      workName: "Mamparas del hogar de San Luis",
      workLocation: formatPeruLocation("Lima Metropolitana", "San Luis"),
      workPlan: "Instalación y sellado de mamparas.",
      completionNote: "Instalación revisada y entregada al cliente.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: index ? null : new Date().toISOString(),
      events: [],
    })),
  );
  const images = [];
  for (const [index, id] of [workId, workId, otherId].entries()) {
    const bytes = await sharp("assets/vivienda.webp")
        .resize(500 + index)
        .webp()
        .toBuffer(),
      form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "image/webp" }),
      `foto-${index}.webp`,
    );
    form.append("caption", "Mamparas y luz natural " + index);
    form.append("tags", JSON.stringify(["Resultado"]));
    form.append("sharing", "internal");
    images.push(await post(`/admin/crm/leads/${id}/files`, form, "admin"));
  }
  const pdf = new FormData();
  pdf.append(
    "file",
    new Blob(["%PDF-1.7\nQA"], { type: "application/pdf" }),
    "contrato.pdf",
  );
  const contract = await post(`/admin/crm/leads/${workId}/files`, pdf, "admin");
  await get(root, "worker", 403);
  await get(root, null, 401);
  await get(`/admin/project-sources/works/${otherId}`, "publisher", 404);
  const warehouseWorks = await get("/admin/warehouse/works", "admin");
  assert.equal(
    warehouseWorks.find((work) => work.id === String(workId)).name,
    "Mamparas del hogar de San Luis",
  );
  const accountingWorks = await get("/admin/accounting/works", "admin");
  assert.equal(
    accountingWorks.find((work) => work.id === String(workId)).name,
    "Mamparas del hogar de San Luis",
  );
  const source = await get(root);
  assert.equal(source.photos.length, 2);
  assert(!("phone" in source.work));
  assert(!("email" in source.work));
  assert.equal(source.work.name, "Mamparas del hogar de San Luis");
  await get(root + "/photos/" + images[0].id);
  await get(root + "/photos/" + contract.id, "publisher", 404);
  await get(root + "/photos/" + images[2].id, "publisher", 404);
  const body = {
    operationId: randomUUID(),
    version: 1,
    photoIds: images.slice(0, 2).map((image) => image.id),
  };
  await post(root + "/draft", body, "worker", 403);
  await post(
    root + "/draft",
    { ...body, photoIds: [images[2].id] },
    "publisher",
    404,
  );
  await post(
    root + "/draft",
    { ...body, photoIds: [contract.id] },
    "publisher",
    404,
  );
  await post(
    root + "/draft",
    { ...body, photoIds: [images[0].id, images[0].id] },
    "publisher",
    400,
  );
  await post(root + "/draft", { ...body, version: 2 }, "publisher", 409);
  let project = await post(root + "/draft", body);
  projectIds.push(project.id);
  mediaIds.push(...body.photoIds);
  assert.equal(project.status, "draft");
  assert.equal(project.title, source.work.name);
  assert.equal(project.location, source.work.location);
  assert.equal(project.sourceWork.id, String(workId));
  assert.equal(project.images.length, 2);
  assert.equal(project.excerpt, "");
  assert.equal((await post(root + "/draft", body)).id, project.id);
  await post(
    root + "/draft",
    { ...body, photoIds: [images[0].id] },
    "publisher",
    409,
  );
  for (const image of project.images) {
    const stored = await db
        .collection("media")
        .findOne({ _id: new ObjectId(image.id) }),
      original = await db
        .collection("crm_files")
        .findOne({ _id: new ObjectId(image.id) });
    assert.equal(
      stored.key,
      original.key,
      "existing storage object must be reused",
    );
    assert.equal(stored.sourceWorkId, String(workId));
    await get("/media/" + image.id, null, 401);
    await get("/media/" + image.id);
  }
  await put(
    `/admin/projects/${project.id}`,
    { ...toInput(project), location: "Arequipa" },
    400,
  );
  const manualBytes = await sharp("assets/mamparas.webp")
      .resize(700)
      .webp()
      .toBuffer(),
    manualForm = new FormData();
  manualForm.append(
    "file",
    new Blob([manualBytes], { type: "image/webp" }),
    "manual.webp",
  );
  const manualPhoto = await post("/media", manualForm);
  mediaIds.push(manualPhoto.id);
  const text = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Un proyecto de mamparas que transforma la luz del hogar con una instalación precisa y acabados cuidados en todos sus detalles.",
          },
        ],
      },
    ],
  };
  project = await put(`/admin/projects/${project.id}`, {
    ...toInput(project),
    title: "Una nueva luz para un hogar",
    excerpt: "Mamparas y acabados que renuevan la luz natural del hogar.",
    images: [
      ...project.images,
      { ...manualPhoto, alt: "Mampara instalada en la sala" },
    ],
    sections: [{ ...project.sections[0], body: text }],
  });
  assert.equal(project.title, "Una nueva luz para un hogar");
  assert.equal(project.images.length, 3);
  project = await post(`/admin/projects/${project.id}/publish`, {
    version: project.version,
  });
  await get("/media/" + images[0].id, null);
  assert.equal(
    (await get("/public/projects/" + project.slug, null)).images.length,
    3,
  );
  const direct = await post("/admin/projects", {
    ...emptyProject(),
    title: "Proyecto creado manualmente",
    location: "Arequipa",
  });
  projectIds.push(direct.id);
  assert(!direct.sourceWork);
  const changed = await put(`/admin/projects/${direct.id}`, {
    ...toInput(direct),
    location: "Cusco",
  });
  assert.equal(changed.location, "Cusco");
  await post(
    "/admin/projects",
    {
      ...emptyProject(),
      title: "Intento de origen falso",
      sourceWork: { id: String(workId) },
    },
    "publisher",
    400,
  );
  const listing = await get("/admin/project-sources/works");
  assert(listing.items.find((work) => work.id === String(workId)).project);
  console.log(
    "PASS work publication: publisher scope, completed works, photo ownership/PDF exclusions, storage reuse, private drafts, idempotency, location lock, editable title, manual upload/creation, and public media after publication.",
  );
} finally {
  await db
    .collection("users")
    .deleteMany({ _id: { $in: [publisherId, workerId] } });
  await db.collection("roles").deleteOne({ id: tag });
  await db
    .collection("projects")
    .deleteMany({ _id: { $in: projectIds.map((id) => new ObjectId(id)) } });
  await db
    .collection("media")
    .deleteMany({ _id: { $in: mediaIds.map((id) => new ObjectId(id)) } });
  await db
    .collection("crm_files")
    .deleteMany({ leadId: { $in: [String(workId), String(otherId)] } });
  await db
    .collection("crm_leads")
    .deleteMany({ _id: { $in: [workId, otherId] } });
  await client.close();
}
