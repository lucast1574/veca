"use client";
import { useLayoutEffect, type RefObject } from "react";

export function useFloatingMenu(
  open: boolean,
  floating: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const panel = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !floating || !panel || !trigger) return;
    panel.showPopover();
    function position() {
      if (!panel || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const below = Math.max(0, top + height - rect.bottom - 16);
      const above = Math.max(0, rect.top - top - 16);
      const upwards =
        below < Math.min(panel.scrollHeight, 300) && above > below;
      panel.style.width = Math.min(rect.width, width - 24) + "px";
      panel.style.maxHeight = Math.min(300, upwards ? above : below) + "px";
      panel.style.left =
        Math.max(
          left + 12,
          Math.min(rect.left, left + width - panel.offsetWidth - 12),
        ) + "px";
      panel.style.top =
        (upwards ? rect.top - panel.offsetHeight - 8 : rect.bottom + 8) + "px";
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      panel.hidePopover();
    };
  }, [open, floating]);
}
