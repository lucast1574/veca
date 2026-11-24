// Explicit, isolated local QA only; never loaded by the production entrypoint.
if (process.env.NODE_ENV !== "test")
  throw new Error("SIRE mock requires NODE_ENV=test");
const nativeFetch = globalThis.fetch;
const jobs = new Map();
const ruc = "20616656156";
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const text = (period, book) => {
  const header = Array(40).fill("");
  header[0] = "RUC";
  header[2] = "Periodo";
  const make = (number) => {
    const cells = Array(40).fill("");
    Object.assign(cells, {
      0: ruc,
      2: period.replace("-", ""),
      6: "01",
      7: "FQA",
    });
    cells[book === "sales" ? 8 : 9] = String(number);
    cells[book === "sales" ? 11 : 12] = "20100066603";
    cells[book === "sales" ? 25 : 24] = "118.00";
    cells[book === "sales" ? 26 : 25] = "PEN";
    return cells.join("|");
  };
  return header.join("|") + "\n" + make(1) + "\n" + make(2) + "\n";
};
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const prefix = `/api/v1/issuer/issuers/${ruc}/sire/`;
  if (url.host !== "api.apisunat.net" || !url.pathname.startsWith(prefix))
    return nativeFetch(input, options);
  if (url.pathname.endsWith("/connection"))
    return response({ configured: true });
  if (url.pathname.endsWith("/proposals") && options.method === "POST") {
    const { period, book } = JSON.parse(options.body);
    const job = `v1.qa.${String(jobs.size)}.sire`;
    jobs.set(job, { period, book, polls: 0 });
    return response({ job, ruc, period, book, status: "pending" }, 201);
  }
  const job = decodeURIComponent(url.pathname.split("/").at(-1));
  const state = jobs.get(job);
  if (!state) return response({ error: { code: "SIRE_INVALID_JOB" } }, 400);
  state.polls++;
  const metadata = {
    job,
    ruc: state.period === "2026-01" ? "20131312955" : ruc,
    period: state.period,
    book: state.book,
  };
  if (state.polls === 1) return response({ ...metadata, status: "pending" });
  return response({
    ...metadata,
    status: "ready",
    files:
      state.period === "2026-04"
        ? []
        : [{ name: "propuesta.txt", text: text(state.period, state.book) }],
  });
};
