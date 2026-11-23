import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
const layers: HTMLElement[] = [];
let unlock: (() => void) | undefined;

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  busy = false,
  size = "default",
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  size?: "default" | "wide";
  className?: string;
}) {
  const id = useId(),
    dialog = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  useEffect(() => {
    const layer = dialog.current?.parentElement;
    if (!layer) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!layers.length) {
      const background =
        document.getElementById("workspace-surface") ??
        document.getElementById("root");
      const wasInert = background?.inert || false;
      const old = document.body.style.overflow;
      if (background) background.inert = true;
      document.body.style.overflow = "hidden";
      unlock = () => {
        if (background) background.inert = wasInert;
        document.body.style.overflow = old;
      };
    }
    const covered = layers.at(-1);
    if (covered) covered.inert = true;
    layers.push(layer);
    const focusables = () =>
      [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ) || []),
      ].filter((el) => el.getClientRects().length);
    (focusables()[0] || dialog.current)?.focus();
    const keys = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer || layer.closest("[hidden]")) return;
      if (
        event.key === "Escape" &&
        !latest.current.busy &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        latest.current.onClose();
      }
      if (event.key === "Tab") {
        const items = focusables(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      const wasTop = layers.at(-1) === layer;
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) {
        unlock?.();
        unlock = undefined;
      } else if (wasTop) {
        layers[layers.length - 1].inert = false;
      }
      if (wasTop) previous?.focus();
    };
  }, []);
  const content = (
    <div
      className="ve-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`ve-modal${size === "wide" ? " ve-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={description ? id + "-description" : undefined}
        ref={dialog}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id={id}>{title}</h2>
            {description && <p id={id + "-description"}>{description}</p>}
          </div>
          <button
            type="button"
            className="ops-icon-button"
            aria-label="Cerrar ventana"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        <div className="ve-modal-body">{children}</div>
        {footer}
      </div>
    </div>
  );
  return createPortal(
    className ? <div className={className}>{content}</div> : content,
    document.getElementById("workspace-overlays") ?? document.body,
  );
}
