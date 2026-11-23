import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  LANDING_PROJECT_LIMIT,
  type LandingProjectItem,
  type Project,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button } from "../../components/ui";

export function LandingCarouselEditor({
  items,
  available,
  saving,
  onChange,
}: {
  items: LandingProjectItem[];
  available: Project[];
  saving: boolean;
  onChange: (items: LandingProjectItem[]) => void;
}) {
  const [picker, setPicker] = useState<string>();
  const [search, setSearch] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const choose = useRef<HTMLInputElement>(null);
  const visible = available.filter(({ title, location }) =>
    `${title} ${location}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  function open(target: string) {
    setPicker(target);
    setSearch("");
    requestAnimationFrame(() => choose.current?.focus());
  }
  function close(target: string) {
    setPicker(undefined);
    requestAnimationFrame(() =>
      (buttons.current.get(target) ?? add.current)?.focus(),
    );
  }
  function pick(id: string) {
    const project = available.find((item) => item.id === id);
    if (!project || !picker) return;
    const item = { id, title: project.title, published: true };
    onChange(
      picker === "add"
        ? [...items, item]
        : items.map((row) => (row.id === picker ? item : row)),
    );
    close(id);
  }
  function move(index: number, offset: -1 | 1) {
    const next = index + offset;
    if (saving || next < 0 || next >= items.length) return;
    const ordered = [...items];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    onChange(ordered);
  }
  const editor = (target: string) => (
    <div
      className="landing-inline-picker"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close(target);
      }}
    >
      <label className="search-input">
        <Search size={17} aria-hidden="true" />
        <input
          ref={choose}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Busca por nombre o ubicación"
          aria-label="Buscar proyecto publicado"
        />
      </label>
      <Select
        label={
          target === "add"
            ? "Elegir proyecto para agregar"
            : "Elegir proyecto de reemplazo"
        }
        value=""
        placeholder={visible.length ? "Elige un proyecto" : "Sin resultados"}
        options={visible.map(({ id, title, location }) => ({
          value: id,
          label: title,
          description: location,
        }))}
        disabled={saving || !visible.length}
        onChange={pick}
      />
      <Button type="button" variant="ghost" onClick={() => close(target)}>
        Cancelar
      </Button>
    </div>
  );
  return (
    <>
      <div className="landing-section-actions">
        <span>
          {items.length} de {LANDING_PROJECT_LIMIT} tarjetas
        </span>
        <button
          className="btn btn-ghost"
          type="button"
          ref={add}
          disabled={
            saving || items.length >= LANDING_PROJECT_LIMIT || !available.length
          }
          onClick={() => open("add")}
        >
          <Plus size={16} aria-hidden="true" /> Agregar proyecto
        </button>
      </div>
      {picker === "add" && editor("add")}
      {items.length ? (
        <ol
          className="landing-projects-list"
          role="list"
          aria-label="Orden del carrusel"
        >
          {items.map(({ id, title, published }, index) => (
            <li key={id}>
              <span className="landing-projects-position" aria-hidden="true">
                {index + 1}
              </span>
              <span className="landing-projects-title">
                {title}
                {!published && <small>Proyecto retirado</small>}
              </span>
              <div className="landing-projects-actions">
                <button
                  type="button"
                  className="ops-icon-button"
                  aria-label={`Cambiar ${title}`}
                  title="Cambiar proyecto"
                  disabled={saving || !available.length}
                  aria-expanded={picker === id}
                  ref={(button) => {
                    if (button) buttons.current.set(id, button);
                    else buttons.current.delete(id);
                  }}
                  onClick={() => open(id)}
                >
                  <ArrowLeftRight size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ops-icon-button"
                  aria-label={`Subir ${title}`}
                  title="Subir"
                  aria-disabled={index === 0 || saving}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ops-icon-button"
                  aria-label={`Bajar ${title}`}
                  title="Bajar"
                  aria-disabled={index === items.length - 1 || saving}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ops-icon-button"
                  aria-label={`Quitar ${title}`}
                  title="Quitar del carrusel"
                  disabled={saving}
                  onClick={() => {
                    onChange(items.filter((item) => item.id !== id));
                    close((items[index + 1] ?? items[index - 1])?.id ?? "add");
                  }}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              {picker === id && editor(id)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">El carrusel queda sin tarjetas.</p>
      )}
    </>
  );
}
