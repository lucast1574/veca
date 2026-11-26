"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useFloatingMenu, scrollMenuOption } from "./useFloatingMenu";
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
  selectedLabel,
  options,
  placeholder,
  onChange,
  search,
  floating = true,
}: {
  id: string;
  label: string;
  value: string;
  selectedLabel?: string;
  options: readonly SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  search?: {
    onChange: (query: string) => void;
    loading: boolean;
    empty: string;
    error?: string;
  };
  floating?: boolean;
}) {
  const uid = useId();
  const listId = uid + "-options";
  const currentLabel =
    selectedLabel ?? options.find((option) => option.value === value)?.label;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const needle = normalized(query);
  const matches = search
    ? search.loading || search.error
      ? []
      : options
    : needle
      ? options.filter((option) => normalized(option.label).includes(needle))
      : options;

  useFloatingMenu(open, floating, input, menu);

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
      scrollMenuOption(
        menu.current,
        menu.current?.querySelector<HTMLElement>("[data-active=true]"),
      );
  }, [active, open, needle]);

  function show() {
    if (open) return;
    setQuery("");
    search?.onChange("");
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
        ref={input}
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
        maxLength={search ? 100 : undefined}
        value={open ? query : (currentLabel ?? "")}
        placeholder={open ? placeholder : (currentLabel ?? placeholder)}
        onFocus={show}
        onClick={show}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          search?.onChange(event.currentTarget.value);
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
      <svg
        className="veca-select-search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <svg
        className="veca-select-search-chevron"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      {open && (
        <div
          ref={menu}
          popover={floating ? "manual" : undefined}
          className="veca-select-menu"
        >
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
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </div>
            ))}
          </div>
          {!matches.length && (
            <p className="veca-select-empty" role="status">
              {search?.error ||
                (search?.loading
                  ? "Buscando…"
                  : search?.empty || "Sin coincidencias")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
