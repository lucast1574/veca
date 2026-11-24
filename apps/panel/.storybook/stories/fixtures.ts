import { http, HttpResponse } from "msw";
import {
  crmLeadDefaults,
  PERMISSIONS,
  type AccountingMargin,
  type Lead,
  type SessionUser,
  type WorkTask,
} from "@veca/content";
const at = "2026-11-24T15:00:00.000Z";
export const user: SessionUser = {
  id: "111111111111111111111111",
  name: "Andrea Salas",
  username: "andrea.demo",
  email: "andrea@example.test",
  role: null,
  roleName: "Coordinación de obras",
  status: "active",
  emailVerified: true,
  avatarUrl: null,
  avatarSource: "none",
  googlePhotoAvailable: false,
  authMethods: ["password"],
  accountCreatedAt: at,
  permissions: [...PERMISSIONS],
};
const team = {
  coordinatorId: user.id,
  coordinatorName: user.name,
  participantIds: ["222222222222222222222222", "333333333333333333333333"],
  participantNames: ["Luis Medina", "Carlos Rojas"],
};
const projects = [
  [
    "Edificio Alameda",
    "San Borja, Lima",
    "Fachada de vidrio templado y barandas de balcones. Instalación por frentes en los pisos 2 al 6.",
    "execution",
  ],
  [
    "Residencia Los Olivos",
    "La Molina, Lima",
    "Mamparas corredizas de sala y ventanas con cierre hermético en dormitorios.",
    "coordination",
  ],
  [
    "Oficinas Mirador",
    "San Isidro, Lima",
    "Divisiones acústicas, puertas de acceso y sala de reuniones en el cuarto piso.",
    "execution",
  ],
  [
    "Local Parque Norte",
    "Los Olivos, Lima",
    "Frente comercial de vidrio y sistema de apertura para el acceso principal.",
    "coordination",
  ],
  [
    "Condominio La Ribera",
    "Santiago de Surco, Lima",
    "Barandas de escalera y balcones, con verificación de anclajes en cada tramo.",
    "execution",
  ],
  [
    "Hotel Valle Claro",
    "Huancayo, Junín",
    "Ventanas y cerramientos de las habitaciones del primer nivel.",
    "completed",
  ],
  [
    "Casa Patio Central",
    "Pueblo Libre, Lima",
    "Techo ligero y mamparas que conectan el patio con la cocina.",
    "completed",
  ],
  [
    "Centro Médico Jardín",
    "Jesús María, Lima",
    "Divisiones de consultorios y puertas de vidrio con herrajes de seguridad.",
    "execution",
  ],
  [
    "Tienda Horizonte",
    "Trujillo, La Libertad",
    "Coordinación de medidas finales y recepción de materiales para la fachada.",
    "coordination",
  ],
] as const;
export const works: Lead[] = projects.map(
  ([name, district, plan, stage], i) => ({
    ...crmLeadDefaults,
    id: (i + 1).toString(16).padStart(24, "0"),
    version: 3,
    name: ["María Torres", "José Paredes", "Lucía Campos"][i % 3],
    email: "contacto@example.test",
    phone: "900000000",
    district,
    requestType: "building",
    segment: "large",
    idea: plan,
    stage,
    workName: name,
    workLocation: district,
    address: district,
    workPlan: plan,
    assignedTo: i % 2 ? "Diego Flores" : user.name,
    contractStatus: "signed",
    contractReference: "Contrato de ejemplo",
    source: "manual",
    createdAt: at,
    updatedAt: at,
    contactedAt: at,
    completedAt: stage === "completed" ? at : null,
    events: [
      {
        at,
        actor: user.name,
        kind: "note",
        text: "Medidas confirmadas con el cliente y equipo asignado.",
      },
    ],
    workAssignment: team,
    workHandoff: {
      status: i === 1 ? "submitted" : "accepted",
      submittedBy: "Diego Flores",
      submittedAt: at,
      observation: "Medidas y planos de instalación revisados.",
    },
    ...(i === 2
      ? {
          stageRequest: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            from: "execution",
            to: "completed",
            status: "pending",
            requestedBy: team.participantIds[0],
            requestedAt: at,
            requestedName: "Luis Medina",
            note: "Instalación revisada. Fotos y conformidad registradas.",
          },
        }
      : {}),
  }),
);
export const tasks: WorkTask[] = [
  [
    "Revisar anclajes del frente norte",
    "Luis Medina",
    "done",
    "2026-11-23",
    "Verificación completada con el coordinador.",
  ],
  [
    "Instalar paños del piso 4",
    "Carlos Rojas",
    "in_progress",
    "2026-11-25",
    "Frente preparado. Avance de instalación: 6 de 10 paños.",
  ],
  [
    "Recibir herrajes de cierre",
    "Luis Medina",
    "blocked",
    "2026-11-25",
    "Pendiente la entrega del proveedor para completar las mamparas.",
  ],
  ["Sellar encuentros de fachada", "Carlos Rojas", "pending", "2026-11-26", ""],
  [
    "Revisión de acabados con el cliente",
    "Andrea Salas",
    "pending",
    "2026-11-27",
    "",
  ],
].map(([title, assignedName, status, dueDate, observation], i) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
  title,
  assignedName,
  assignedTo: team.participantIds[i % 2],
  status: status as WorkTask["status"],
  dueDate,
  observation,
  updatedAt: at,
  updatedBy: user.name,
}));
export const margin: AccountingMargin = {
  workId: works[0].id,
  workName: works[0].workName,
  sales: 18_000_000,
  costs: 12_500_000,
  paid: 14_800_000,
  balance: 6_440_000,
  costCount: 18,
  materialCosts: 7_800_000,
  labor: { available: true, payroll: 2_400_000, fees: 800_000 },
  budgetCents: 14_000_000,
  pendingValuation: false,
  manualMaterialsToReview: 0,
};
const base = "http://veca-storybook.invalid";
export const handlers = [
  http.get(`${base}/account/notifications`, () =>
    HttpResponse.json({ items: [], unread: 0 }),
  ),
  http.get(`${base}/account/notifications/config`, () =>
    HttpResponse.json({ enabled: false }),
  ),
  http.get(
    /http:\/\/veca-storybook\.invalid\/.*\/events$/,
    () =>
      new HttpResponse('data: {"topic":"heartbeat"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
  ),
  http.get(`${base}/admin/works`, ({ request }) => {
    const q = new URL(request.url).searchParams,
      search = (q.get("search") || "").toLowerCase();
    const items = works.filter(
      (w) =>
        (!q.get("stage") || w.stage === q.get("stage")) &&
        `${w.workName} ${w.district} ${w.assignedTo}`
          .toLowerCase()
          .includes(search) &&
        (!q.get("mine") || w.workAssignment?.coordinatorId === user.id),
    );
    return HttpResponse.json({ items, total: items.length, page: 1, pages: 1 });
  }),
  http.get(`${base}/admin/works/:id/tasks`, () =>
    HttpResponse.json({
      items: tasks,
      version: 3,
      people: [
        { id: user.id, name: user.name },
        ...team.participantIds.map((id, i) => ({
          id,
          name: team.participantNames[i],
        })),
      ],
      stage: "execution",
    }),
  ),
  http.get(`${base}/admin/works/:id`, ({ params }) =>
    HttpResponse.json({
      lead: { ...works.find((w) => w.id === params.id), workTasks: tasks },
      attachments: [],
      movements: [],
    }),
  ),
  http.get(`${base}/admin/crm/materials`, () => HttpResponse.json([])),
  http.get(`${base}/admin/accounting/works`, () =>
    HttpResponse.json(works.map((w) => ({ id: w.id, name: w.workName }))),
  ),
  http.get(`${base}/admin/accounting/margin/:id`, () =>
    HttpResponse.json(margin),
  ),
  http.all(`${base}/*`, () =>
    HttpResponse.json(
      { message: "Esta acción es una vista de ejemplo y no modifica datos." },
      { status: 403 },
    ),
  ),
];
