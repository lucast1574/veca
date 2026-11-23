import { useEffect, useRef } from "react";

const navigationEvent = "veca-before-navigate";

export function confirmDiscard(dirty: boolean, busy = false) {
  return (
    !busy &&
    (!dirty || window.confirm("Tienes cambios sin guardar. ¿Descartarlos?"))
  );
}

export function canLeaveWorkspace() {
  return window.dispatchEvent(new Event(navigationEvent, { cancelable: true }));
}

export function useUnsavedChanges(dirty: boolean, busy = false) {
  const state = useRef({ dirty, busy });
  state.current = { dirty, busy };
  useEffect(() => {
    if (!dirty && !busy) return;
    function unload(event: BeforeUnloadEvent) {
      if (!state.current.dirty && !state.current.busy) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function navigate(event: Event) {
      if (
        !event.defaultPrevented &&
        !confirmDiscard(state.current.dirty, state.current.busy)
      )
        event.preventDefault();
    }
    window.addEventListener("beforeunload", unload);
    window.addEventListener(navigationEvent, navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(navigationEvent, navigate);
    };
  }, [dirty, busy]);
  return () => {
    state.current = { dirty: false, busy: false };
  };
}
