import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, within } from "storybook/test";
import {
  suggestionCreate,
  suggestionCommentCreate,
  type SessionUser,
  type Suggestion,
  type SuggestionComment,
} from "@veca/content";
import { SuggestionsWorkspace } from "../../src/features/suggestions/SuggestionsWorkspace";
import { StoryFrame } from "./StoryFrame";
import { handlers, user } from "./fixtures";
const employee: SessionUser = {
  ...user,
  name: "Jorge Quispe",
  roleName: "Almacén",
  permissions: ["inventory", "inventory_receive"],
};
const administrator: SessionUser = {
  ...user,
  id: "222222222222222222222222",
  name: "Andrea Salas",
  role: "admin",
  roleName: "Administración",
  permissions: ["dashboard", "users"],
};
const at = "2026-11-25T14:00:00.000Z";
type Example = Suggestion & { comments: SuggestionComment[] };
const seed: Example[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Encontrar una obra por su distrito",
    body: "Cuando coordinamos varias obras en Lima, nos ayudaría encontrar juntas las que están en el mismo distrito. Así podríamos organizar mejor las visitas y las entregas de materiales.",
    section: "works",
    status: "reviewing",
    author: { id: employee.id, name: employee.name },
    createdAt: at,
    updatedAt: at,
    version: 1,
    comments: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
        suggestionId: "11111111-1111-4111-8111-111111111111",
        body: "También serviría al programar los recorridos del transporte. A veces tenemos dos entregas cerca y no lo vemos a tiempo.",
        author: { id: "333333333333333333333333", name: "Luis Medina" },
        createdAt: at,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
        suggestionId: "11111111-1111-4111-8111-111111111111",
        body: "Estamos revisando esta idea. Gracias por explicar cómo ayudaría al equipo; pueden sumar más ejemplos aquí.",
        author: { id: administrator.id, name: administrator.name },
        createdAt: at,
      },
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Agrupar los pedidos pendientes por proveedor",
    body: "Al recibir materiales sería más cómodo ver qué pedidos pendientes tenemos con el mismo proveedor antes de registrar una entrega.",
    section: "inventory",
    status: "open",
    author: { id: "333333333333333333333333", name: "Luis Medina" },
    createdAt: "2026-11-24T14:00:00.000Z",
    updatedAt: at,
    version: 1,
    comments: [],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Que el documento de entrega sea opcional",
    body: "Algunos proveedores entregan materiales sin documento. Necesitamos poder confirmar lo recibido y completar la referencia si está disponible.",
    section: "inventory",
    status: "implemented",
    author: { id: employee.id, name: employee.name },
    createdAt: "2026-11-23T14:00:00.000Z",
    updatedAt: at,
    version: 1,
    comments: [],
  },
];
let rows: Example[] = structuredClone(seed),
  failNext = false;
const mocks = [
  http.get("*/admin/suggestions", ({ request }) => {
    const q = new URL(request.url).searchParams,
      search = (q.get("search") || "").toLowerCase(),
      section = q.get("section");
    const found = rows.filter(
      (row) =>
        (!section || row.section === section) &&
        (!search || (row.title + row.body).toLowerCase().includes(search)),
    );
    return HttpResponse.json({
      items: found.map(({ comments, ...row }) => ({
        ...row,
        commentCount: comments.length,
      })),
      hasMore: false,
    });
  }),
  http.get("*/admin/suggestions/:id", ({ params }) => {
    const row = rows.find((row) => row.id === params.id);
    if (!row)
      return HttpResponse.json(
        { message: "No encontramos esta sugerencia." },
        { status: 404 },
      );
    const { comments, ...topic } = row;
    return HttpResponse.json({
      topic,
      comments,
      commentCount: comments.length,
      hasMoreComments: false,
    });
  }),
  http.post("*/admin/suggestions", async ({ request }) => {
    if (failNext) {
      failNext = false;
      return HttpResponse.json(
        { message: "No pudimos publicar la sugerencia. Vuelve a intentarlo." },
        { status: 503 },
      );
    }
    const parsed = suggestionCreate.parse(await request.json());
    const topic: Example = {
      ...parsed,
      author: { id: employee.id, name: employee.name },
      status: "open",
      version: 1,
      createdAt: at,
      updatedAt: at,
      comments: [],
    };
    rows.unshift(topic);
    return HttpResponse.json(topic, { status: 201 });
  }),
  http.post("*/admin/suggestions/:id/comments", async ({ request, params }) => {
    const row = rows.find((row) => row.id === params.id);
    if (!row)
      return HttpResponse.json(
        { message: "No encontramos esta sugerencia." },
        { status: 404 },
      );
    const data = suggestionCommentCreate.parse(await request.json());
    const comment: SuggestionComment = {
      ...data,
      suggestionId: row.id,
      author: { id: employee.id, name: employee.name },
      createdAt: at,
    };
    row.comments.push(comment);
    return HttpResponse.json(comment, { status: 201 });
  }),
  http.put("*/admin/suggestions/:id/status", async ({ request, params }) => {
    const row = rows.find((row) => row.id === params.id);
    if (!row)
      return HttpResponse.json(
        { message: "No encontramos esta sugerencia." },
        { status: 404 },
      );
    const data = (await request.json()) as Pick<Suggestion, "status">;
    row.status = data.status;
    row.version++;
    return HttpResponse.json(row);
  }),
];
function reset(id = "") {
  rows = structuredClone(seed);
  failNext = false;
  history.replaceState(null, "", `#suggestions${id ? `/${id}` : ""}`);
}
const render = (sessionUser: SessionUser) => (
  <StoryFrame view="suggestions" sessionUser={sessionUser}>
    <SuggestionsWorkspace user={sessionUser} />
  </StoryFrame>
);
const meta = {
  title: "VECA/Sugerencias del equipo",
  parameters: { msw: [...mocks, ...handlers] },
  beforeEach() {
    reset();
  },
  render: () => render(employee),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ForoConActividad: Story = {
  name: "01 · Foro de sugerencias del equipo",
};
export const Conversacion: Story = {
  name: "02 · Conversación y seguimiento",
  beforeEach() {
    reset(seed[0].id);
  },
};
export const NuevaSugerencia: Story = {
  name: "03 · Nueva sugerencia en un modal",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: /Nueva sugerencia/ }),
    );
    await expect(
      page.findByRole("dialog", { name: "Nueva sugerencia" }),
    ).resolves.toBeVisible();
  },
};
async function writeIdea(page: ReturnType<typeof within>) {
  await userEvent.click(
    await page.findByRole("button", { name: /Nueva sugerencia/ }),
  );
  await userEvent.type(
    page.getByRole("textbox", { name: "Título" }),
    "Ver las entregas de mañana",
  );
  await userEvent.type(
    page.getByRole("textbox", { name: "¿Qué mejorarías?" }),
    "Sería útil ver qué materiales esperamos recibir al día siguiente para preparar el espacio del almacén.",
  );
}
export const PublicarYComentar: Story = {
  name: "04 · Publicar una idea y comentarla",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await writeIdea(page);
    await userEvent.click(
      page.getByRole("button", { name: "Publicar sugerencia" }),
    );
    await expect(
      page.findByRole("heading", { name: "Ver las entregas de mañana" }),
    ).resolves.toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Comentar" }));
    await userEvent.type(
      page.getByRole("textbox", { name: "Tu comentario" }),
      "Así podríamos ordenar la zona de recepción antes de que llegue el camión.",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Publicar comentario" }),
    );
    await expect(
      page.findByText(
        "Así podríamos ordenar la zona de recepción antes de que llegue el camión.",
      ),
    ).resolves.toBeVisible();
  },
};
export const GuardadoConReintento: Story = {
  name: "05 · Reintentar sin perder la sugerencia",
  beforeEach() {
    reset();
    failNext = true;
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await writeIdea(page);
    await userEvent.click(
      page.getByRole("button", { name: "Publicar sugerencia" }),
    );
    await expect(page.findByRole("alert")).resolves.toHaveTextContent(
      "No pudimos publicar",
    );
    await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue(
      "Ver las entregas de mañana",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Publicar sugerencia" }),
    );
    await expect(
      page.findByRole("heading", { name: "Ver las entregas de mañana" }),
    ).resolves.toBeVisible();
  },
};
export const Administracion: Story = {
  name: "06 · Administración cambia el estado",
  beforeEach() {
    reset(seed[0].id);
  },
  render: () => render(administrator),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Cambiar estado" }),
    );
    await userEvent.click(
      page.getByRole("combobox", { name: "Estado de la sugerencia" }),
    );
    await userEvent.click(
      await page.findByRole("option", { name: "Aplicada" }),
    );
    await userEvent.click(page.getByRole("button", { name: "Guardar estado" }));
    await expect(page.findByText("Aplicada")).resolves.toBeVisible();
  },
};
