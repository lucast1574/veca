import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, within } from "storybook/test";
import type {
  LaborEmployee,
  PayrollRun,
  WorkPayrollIncident,
  SessionUser,
} from "@veca/content";
import { StoryFrame } from "./StoryFrame";
import { user, works, handlers } from "./fixtures";
import { Dashboard } from "../../src/features/dashboard/Dashboard";
import { LaborWorkspace } from "../../src/features/accounting/labor/LaborWorkspace";
import { UserProfile } from "../../src/features/profile/UserProfile";
import { WorkPayrollIncidents } from "../../src/features/works/WorkPayrollIncidents";
const worker: SessionUser = {
  ...user,
  id: "222222222222222222222222",
  name: "Luis Medina · Ejemplo",
  email: "luis.demo@example.com",
  username: "luis.demo",
  role: "worker",
  roleName: "Personal técnico",
  permissions: ["dashboard", "works", "works_report"],
};
const employee: LaborEmployee = {
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  name: worker.name,
  documentType: "DNI",
  documentNumber: "70000001",
  position: "Técnico instalador",
  hireDate: "2026-01-01",
  endDate: "",
  salaryCents: 260000,
  pensionSystem: "onp",
  laborRegime: "general",
  healthSystem: "essalud",
  regimeReference: "",
  active: true,
  account: { userId: worker.id, userName: worker.name, revision: 1 },
};
const line = {
  employeeId: employee.id,
  employeeName: employee.name,
  days: 30,
  taxableExtraCents: 20000,
  nonTaxableCents: 0,
  afpDeductionCents: 0,
  employerContributionCents: 0,
  gratuityCents: 0,
  ctsCents: 65000,
  vacationCents: 0,
  fifthCategoryCents: 0,
  otherDeductionCents: 1000,
  grossCents: 280000,
  netCents: 242600,
  employerEssaludCents: 25200,
};
const run: PayrollRun = {
  id: "20000000-0000-4000-8000-000000000001",
  revision: 2,
  period: "2026-11",
  minimumWageCents: 113000,
  lines: [line],
  status: "draft",
  grossCents: 280000,
  deductionCents: 37400,
  netCents: 242600,
  employerEssaludCents: 25200,
  paidAt: null,
  paymentReference: "",
  workDeductions: [],
};
const incident: WorkPayrollIncident = {
  id: "aaaaaaaaaaaaaaaaaaaaaa01",
  revision: 1,
  workId: works[0].id,
  workName: works[0].workName,
  employeeId: employee.id,
  employeeName: employee.name,
  date: "2026-11-24",
  period: "2026-11",
  kind: "waste",
  item: "Vidrio templado de 10 mm",
  quantityNote: "1 m²",
  reason:
    "Corte fuera de las medidas aprobadas. Incidencia revisada con el técnico.",
  cents: 5000,
  status: "authorized",
  createdAt: "2026-11-24T17:00:00.000Z",
  createdBy: "Andrea Salas",
  authorization: {
    basis: "agreement",
    reference: "Autorización firmada AT-024 · 24/11/2026",
    by: "Andrea Salas",
    at: "2026-11-24T18:00:00.000Z",
  },
};
const reported = {
  ...incident,
  id: "aaaaaaaaaaaaaaaaaaaaaa02",
  status: "reported" as const,
  authorization: undefined,
  kind: "damage" as const,
  item: "Herraje de acero inoxidable",
  reason:
    "Daño durante la instalación. Pendiente de revisar el sustento con el trabajador.",
  cents: 3500,
  quantityNote: "1 unidad",
};
const queue = [
  {
    key: "handoffs",
    title: "Entregas a Operaciones",
    count: 3,
    href: "#works",
    items: [
      {
        id: "1",
        title: "Edificio Alameda",
        detail: "Entrega pendiente de aceptación",
        href: `#works/${works[0].id}`,
      },
    ],
  },
  {
    key: "supplies",
    title: "Solicitudes a Almacén",
    count: 5,
    href: "#inventory",
    items: [
      {
        id: "2",
        title: "Vidrio para fachada",
        detail: "Edificio Alameda · Por reservar",
        href: "#inventory",
      },
    ],
  },
  {
    key: "work_deductions",
    title: "Descuentos al personal",
    count: 1,
    href: "#accounting/personal",
    items: [
      {
        id: incident.id,
        title: employee.name,
        detail: incident.workName + " · Planilla 2026-11",
        href: "#accounting/personal",
      },
    ],
  },
];
const visuals = {
  workStages: { coordination: 5, execution: 12, completed: 34 },
  activity: [8, 10, 12, 14, 18, 19].map((received, i) => ({
    period: `2026-${String(6 + i).padStart(2, "0")}`,
    received,
    completed: [1, 2, 3, 6, 9, 13][i],
  })),
  stock: { available: 17, low: 4, empty: 2 },
  publications: { published: 12, draft: 4 },
};
const summary = {
  visuals,
  stages: {
    prelead: 18,
    contacted: 12,
    coordination: 5,
    execution: 12,
    completed: 34,
  },
  upcoming: [
    {
      id: works[0].id,
      name: works[0].workName,
      appointment: "2026-11-27T09:00:00-05:00",
      district: "San Borja",
    },
  ],
  lowStock: [
    {
      id: "bbbbbbbbbbbbbbbbbbbbbbb2",
      name: "Herrajes de acero inoxidable",
      sku: "HER-INOX",
      unit: "unit",
      balance: 2,
      minimum: 6,
    },
  ],
  accounting: { guides: 3, requests: 2, collect: 4 },
  publishedProjects: 12,
  pendingUsers: 2,
};
let current = structuredClone(run);
let currentIncidents = structuredClone([incident, reported]);
const mocks = [
  http.get("*/admin/dashboard", () => HttpResponse.json(summary)),
  http.get("*/admin/dashboard/inbox", () => HttpResponse.json(queue)),
  http.get("*/admin/accounting/period/:month/overview", () =>
    HttpResponse.json({
      months: [16, 20, 23, 28].map((n, i) => ({
        period: `2026-${String(8 + i).padStart(2, "0")}`,
        salesNet: n * 1000000,
        salesTax: n * 180000,
        costsNet: (n - 5) * 1000000,
        costsTax: (n - 5) * 180000,
      })),
      costBreakdown: [],
    }),
  ),
  http.get("*/admin/accounting/labor", () =>
    HttpResponse.json({
      period: "2026-11",
      employees: [employee],
      regimes: [
        {
          code: "general",
          label: "Régimen general privado",
          guidance: "Verifica el régimen del trabajador.",
          requiresReference: false,
          defaultHealthSystem: "essalud",
          healthSystems: ["essalud", "eps"],
        },
      ],
      runs: [current],
      receipts: [],
      allocations: [],
      incidents: currentIncidents,
    }),
  ),
  http.get("*/admin/accounting/labor/accounts", () =>
    HttpResponse.json([
      { id: worker.id, name: worker.name, username: "luis.demo" },
      { id: user.id, name: user.name, username: user.username },
    ]),
  ),
  http.put("*/admin/accounting/labor/accounts/:id", () =>
    HttpResponse.json({ ok: true }),
  ),
  http.get("*/admin/works/:id/payroll-incidents", () =>
    HttpResponse.json({
      canManage: true,
      employees: [
        { id: employee.id, name: employee.name, position: employee.position },
      ],
      items: currentIncidents,
    }),
  ),
  http.get("*/account/payroll", () =>
    HttpResponse.json({
      linked: true,
      period: "2026-11",
      employeeName: employee.name,
      position: employee.position,
      salaryCents: employee.salaryCents,
      regimeLabel: "Régimen general privado",
      run: {
        id: run.id,
        status: "approved",
        period: run.period,
        paidAt: null,
        paymentReference: "",
      },
      line: { ...line, otherDeductionCents: 6000, netCents: 237600 },
      incidents: [
        { ...incident, payrollRunId: run.id, payrollStatus: "approved" },
      ],
    }),
  ),
  http.post("*/admin/accounting/labor/incidents/:id/approve", ({ params }) => {
    const row = currentIncidents.find((i) => i.id === params.id)!;
    if (!row.payrollRunId) {
      row.status = "approved";
      row.revision++;
      row.payrollRunId = run.id;
      row.approval = { by: "Andrea Salas", at: "2026-11-25T14:00:00Z" };
      current = {
        ...current,
        revision: current.revision + 1,
        lines: current.lines.map((l) => ({
          ...l,
          otherDeductionCents: l.otherDeductionCents + row.cents,
          netCents: l.netCents - row.cents,
        })),
        netCents: current.netCents - row.cents,
        deductionCents: current.deductionCents + row.cents,
        workDeductions: [
          ...(current.workDeductions || []),
          structuredClone(row),
        ],
      };
    }
    return HttpResponse.json({ item: row, applied: true });
  }),
  ...handlers,
];
const meta = {
  title: "VECA/Personal y nuevo Resumen",
  parameters: { msw: mocks },
  beforeEach() {
    current = structuredClone(run);
    currentIncidents = structuredClone([incident, reported]);
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ResumenGeneral: Story = {
  name: "01 · Resumen visual de Administración",
  render: () => (
    <StoryFrame view="dashboard">
      <Dashboard
        user={{ ...user, role: "admin", roleName: "Administración" }}
      />
    </StoryFrame>
  ),
};
export const ResumenTecnico: Story = {
  name: "02 · Resumen del personal técnico",
  parameters: {
    msw: [
      http.get("*/admin/dashboard", () =>
        HttpResponse.json({
          ...summary,
          stages: {},
          accounting: null,
          lowStock: [],
          upcoming: [],
          publishedProjects: null,
          pendingUsers: null,
          visuals: {
            ...visuals,
            stock: null,
            publications: null,
            workStages: { coordination: 1, execution: 2, completed: 4 },
            activity: visuals.activity.map((r, i) => ({
              ...r,
              received: null,
              completed: [0, 0, 0, 1, 1, 2][i],
            })),
          },
        }),
      ),
      http.get("*/admin/dashboard/inbox", () =>
        HttpResponse.json([
          {
            key: "tasks",
            title: "Mis tareas de obra",
            count: 2,
            href: "#works",
            items: [
              {
                id: "1",
                title: "Revisar instalación de fachada",
                detail: "Edificio Alameda · Hoy",
                href: `#works/${works[0].id}`,
              },
            ],
          },
        ]),
      ),
      ...mocks,
    ],
  },
  render: () => (
    <StoryFrame view="dashboard" sessionUser={worker}>
      <Dashboard user={worker} />
    </StoryFrame>
  ),
};
export const PlanillaBonos: Story = {
  name: "03 · Planilla con bonos y descuentos",
  render: () => (
    <StoryFrame view="accounting">
      <main className="ops-page">
        <LaborWorkspace />
      </main>
    </StoryFrame>
  ),
};
export const VincularCuenta: Story = {
  ...PlanillaBonos,
  name: "04 · Vinculación opcional de la cuenta",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: /Trabajadores/ }),
    );
    await userEvent.click(
      await page.findByRole("button", { name: "Cuenta VECA" }),
    );
    await expect(
      page.findByRole("dialog", { name: "Vincular cuenta VECA" }),
    ).resolves.toBeVisible();
  },
};
export const IncidenciasObra: Story = {
  name: "05 · Incidencias a cargo del encargado",
  render: () => (
    <StoryFrame view="works">
      <main className="ops-page">
        <WorkPayrollIncidents workId={works[0].id} />
      </main>
    </StoryFrame>
  ),
};
export const RegistrarIncidencia: Story = {
  ...IncidenciasObra,
  name: "06 · Registrar desperdicio o rotura",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Registrar incidencia" }),
    );
    await expect(
      page.findByRole("dialog", { name: "Registrar incidencia de materiales" }),
    ).resolves.toBeVisible();
  },
};
export const SustentarDescuento: Story = {
  ...IncidenciasObra,
  name: "07 · Sustento antes de Planilla",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Registrar sustento" }),
    );
    await expect(
      page.findByRole("dialog", { name: "Sustento del descuento" }),
    ).resolves.toBeVisible();
  },
};
export const IncorporarDescuento: Story = {
  ...PlanillaBonos,
  name: "08 · Aprobar descuento y actualizar Planilla",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole("button", { name: "Descuentos al personal" }),
    );
    await userEvent.click(
      await page.findByRole("button", { name: "Aprobar descuento" }),
    );
    await expect(
      page.findByRole("dialog", { name: "Aprobar descuento al personal" }),
    ).resolves.toBeVisible();
  },
};
export const MiRemuneracion: Story = {
  name: "09 · Mi remuneración privada en el perfil",
  render: () => (
    <StoryFrame view="profile" sessionUser={worker}>
      <UserProfile
        user={worker}
        onLogout={async () => {}}
        onNavigate={() => false}
        onUpdate={() => {}}
      />
    </StoryFrame>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByText("Ver bonos, beneficios y descuentos", {
        exact: true,
      }),
    );
  },
};
