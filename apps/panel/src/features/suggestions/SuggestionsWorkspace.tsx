import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import {
  canViewAdministration,
  SUGGESTION_COMMENTS_PAGE_SIZE,
  SUGGESTION_SECTIONS,
  SUGGESTION_STATUSES,
  type SessionUser,
  type Suggestion,
  type SuggestionDetail,
  type SuggestionSummary,
} from "@veca/content";
import { Button, Field } from "../../components/ui";
import {
  Pagination,
  QueryState,
  Refresh,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import {
  CommentDialog,
  StatusDialog,
  suggestionsPath,
  TopicDialog,
} from "./SuggestionDialogs";
import "../accounting/accounting.css";
import "./suggestions.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Lima",
  }).format(new Date(value));
function Status({ status }: Pick<Suggestion, "status">) {
  return (
    <span className="suggestion-status" data-status={status}>
      {SUGGESTION_STATUSES[status]}
    </span>
  );
}
const routeId = () => location.hash.split("/")[1] || "";
export function SuggestionsWorkspace({ user }: { user: SessionUser }) {
  const [id, setId] = useState(routeId);
  useEffect(() => {
    const change = () => setId(routeId());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return (
    <main className="suggestions-page">
      {id ? <TopicDetail key={id} id={id} user={user} /> : <TopicList />}
    </main>
  );
}
function TopicList() {
  const [creating, setCreating] = useState(false),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [section, setSection] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuerySearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    page: String(page),
    search: querySearch,
    section,
  });
  const query = useAccountingQuery<{
    items: SuggestionSummary[];
    hasMore: boolean;
  }>(`${suggestionsPath}?${params}`);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") query.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [query.refresh]);
  return (
    <>
      <header className="suggestions-heading">
        <div>
          <h1>Sugerencias</h1>
          <p>
            Ideas del equipo para mejorar la plataforma. Comparte la tuya o suma
            tu experiencia.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} /> Nueva sugerencia
        </Button>
      </header>
      <div className="suggestions-filters">
        <Field label="Buscar sugerencias">
          <div className="suggestions-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar sugerencias"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="Busca una idea antes de publicar"
            />
          </div>
        </Field>
        <Field label="Sección">
          <Select
            label="Filtrar sugerencias por sección"
            value={section}
            onChange={(value) => {
              setSection(value);
              setPage(1);
            }}
            options={[
              { value: "", label: "Todas las secciones" },
              ...Object.entries(SUGGESTION_SECTIONS).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </Field>
        <Refresh loading={query.loading} onClick={query.refresh} />
      </div>
      <QueryState {...query}>
        {query.data && !query.loading && !query.data.items.length && (
          <section className="suggestions-empty">
            <MessageSquare size={28} aria-hidden="true" />
            <h2>
              {querySearch || section
                ? "No encontramos sugerencias"
                : "Tu experiencia puede mejorar la plataforma"}
            </h2>
            <p>
              {querySearch || section
                ? "Prueba otra búsqueda o sección."
                : "Comparte una idea para que el equipo pueda comentarla."}
            </p>
          </section>
        )}
        <ul className="suggestions-list">
          {query.data?.items.map((topic) => (
            <li key={topic.id}>
              <a
                className="suggestion-card"
                href={`#suggestions/${topic.id}`}
                aria-label={`Ver sugerencia: ${topic.title}`}
              >
                <div className="suggestion-card-heading">
                  <h2>{topic.title}</h2>
                  <Status status={topic.status} />
                </div>
                <p className="suggestion-excerpt">{topic.body}</p>
                <div className="suggestion-meta">
                  <span>
                    {topic.author.name} · {SUGGESTION_SECTIONS[topic.section]} ·{" "}
                    {date(topic.createdAt)}
                  </span>
                  <span className="suggestion-comments-count">
                    <MessageSquare size={14} aria-hidden="true" />
                    {topic.commentCount}{" "}
                    {topic.commentCount === 1 ? "comentario" : "comentarios"}
                  </span>
                </div>
                <span className="suggestion-open">
                  Ver conversación <ArrowRight size={15} aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </QueryState>
      <Pagination
        page={page}
        hasMore={Boolean(query.data?.hasMore)}
        change={setPage}
      />
      {creating && (
        <TopicDialog
          close={() => setCreating(false)}
          saved={(topic) => {
            setCreating(false);
            location.hash = `suggestions/${topic.id}`;
          }}
        />
      )}
    </>
  );
}
function TopicDetail({ id, user }: { id: string; user: SessionUser }) {
  const [page, setPage] = useState(1),
    [commenting, setCommenting] = useState(false),
    [editing, setEditing] = useState<Suggestion>(),
    [changing, setChanging] = useState<Suggestion>();
  const query = useAccountingQuery<SuggestionDetail>(
    `${suggestionsPath}/${id}?page=${page}`,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") query.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [query.refresh]);
  const detail = query.data;
  const topic = detail?.topic;
  const canManage = canViewAdministration(user);
  return (
    <>
      <a className="suggestions-back" href="#suggestions">
        <ArrowLeft size={16} /> Volver a sugerencias
      </a>
      <QueryState {...query}>
        {topic && detail && (
          <>
            <article className="suggestion-topic">
              <div className="suggestion-topic-top">
                <Status status={topic.status} />
                <div className="suggestion-topic-actions">
                  {(topic.author.id === user.id || canManage) && (
                    <Button variant="ghost" onClick={() => setEditing(topic)}>
                      <Pencil size={14} /> Editar sugerencia
                    </Button>
                  )}
                  {canManage && (
                    <Button variant="ghost" onClick={() => setChanging(topic)}>
                      Cambiar estado
                    </Button>
                  )}
                </div>
              </div>
              <h1>{topic.title}</h1>
              <p className="suggestion-meta">
                {topic.author.name} · {SUGGESTION_SECTIONS[topic.section]} ·{" "}
                {date(topic.createdAt)}
              </p>
              <p className="suggestion-body">{topic.body}</p>
            </article>
            <section
              className="suggestion-conversation"
              aria-labelledby="suggestion-conversation-title"
            >
              <header>
                <div>
                  <h2 id="suggestion-conversation-title">Conversación</h2>
                  <p>
                    {detail.commentCount}{" "}
                    {detail.commentCount === 1 ? "comentario" : "comentarios"}
                  </p>
                </div>
                <Button onClick={() => setCommenting(true)}>
                  <MessageSquare size={16} /> Comentar
                </Button>
              </header>
              {!detail.comments.length && (
                <p className="suggestions-no-comments">
                  Todavía no hay comentarios. Comparte tu punto de vista.
                </p>
              )}
              <ol>
                {detail.comments.map((comment) => (
                  <li key={comment.id}>
                    <article className="suggestion-comment">
                      <header>
                        <strong>{comment.author.name}</strong>
                        <time dateTime={comment.createdAt}>
                          {date(comment.createdAt)}
                        </time>
                      </header>
                      <p className="suggestion-body">{comment.body}</p>
                    </article>
                  </li>
                ))}
              </ol>
              <Pagination
                page={page}
                hasMore={detail.hasMoreComments}
                change={setPage}
              />
            </section>
          </>
        )}
      </QueryState>
      {editing && (
        <TopicDialog
          initial={editing}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            query.refresh();
          }}
        />
      )}
      {changing && (
        <StatusDialog
          topic={changing}
          close={() => setChanging(undefined)}
          saved={() => {
            setChanging(undefined);
            query.refresh();
          }}
        />
      )}
      {commenting && (
        <CommentDialog
          topicId={id}
          close={() => setCommenting(false)}
          saved={() => {
            setCommenting(false);
            setPage(
              Math.floor(
                (query.data?.commentCount || 0) / SUGGESTION_COMMENTS_PAGE_SIZE,
              ) + 1,
            );
            query.refresh();
          }}
        />
      )}
    </>
  );
}
