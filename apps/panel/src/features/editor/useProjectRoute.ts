import { useEffect } from "react";
import type { Project } from "@veca/content";
import { api } from "../../lib/api";
export function useProjectRoute(
  enabled: string | undefined,
  onProject: (project: Project | null | undefined) => void,
  onPhotos: (id: string | undefined) => void,
  onError: (message: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const update = () => {
      controller?.abort();
      const work = location.hash.match(
        /^#projects\/from-work\/([a-f\d]{24})$/i,
      );
      onPhotos(work?.[1]);
      if (work) {
        onProject(undefined);
        return;
      }
      const project = location.hash.match(/^#projects\/([a-f\d]{24})$/i);
      if (!project) return;
      controller = new AbortController();
      const current = controller;
      void api<Project>(`/admin/projects/${project[1]}`, {
        signal: current.signal,
      })
        .then((result) => {
          if (!current.signal.aborted) onProject(result);
        })
        .catch((error: Error) => {
          if (!current.signal.aborted) onError(error.message);
        });
    };
    window.addEventListener("hashchange", update);
    update();
    return () => {
      controller?.abort();
      window.removeEventListener("hashchange", update);
    };
  }, [enabled, onProject, onPhotos, onError]);
}
