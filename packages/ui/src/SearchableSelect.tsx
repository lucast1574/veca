import { useEffect, useId, useRef, useState } from "react";
import type { SelectOption } from "./Select";

const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

export function SearchableSelect({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const uid = useId();
  const listId = uid + "-options";
  const selected = options.find((option) => option.value === value);
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const needle = normalized(query);
  const matches = needle
    ? options.filter((option) => normalized(option.label).includes(needle))
    : options;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector("[data-active=true]")
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, needle]);

  function show() {
    if (open) return;
    setQuery("");
    setActive(
      Math.max(
        options.findIndex((option) => option.value === value),
        0,
      ),
    );
    setOpen(true);
  }
  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div ref={root} className={`veca-select${open ? " is-open" : ""}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && matches[active] ? `${uid}-${active}` : undefined
        }
        className="veca-select-trigger veca-select-search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected?.label ?? placeholder}
        onFocus={show}
        onClick={show}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            event.currentTarget.select();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) show();
            else if (matches.length) {
              const offset = event.key === "ArrowDown" ? 1 : -1;
              setActive((active + offset + matches.length) % matches.length);
            }
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!open) show();
            else if (matches[active]) choose(matches[active]);
          }
        }}
      />
      {open && (
        <div className="veca-select-menu">
          <div role="listbox" id={listId} aria-label={label}>
            {matches.map((option, i) => (
              <div
                key={option.value}
                id={`${uid}-${i}`}
                role="option"
                aria-selected={option.value === value}
                data-active={active === i}
                className={`veca-select-option${active === i ? " is-active" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <strong>{option.label}</strong>
              </div>
            ))}
          </div>
          {!matches.length && (
            <p className="veca-select-empty" role="status">
              Sin coincidencias
            </p>
          )}
        </div>
      )}
    </div>
  );
}
