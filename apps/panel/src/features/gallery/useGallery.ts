import { useCallback, useEffect, useState } from "react";
import type { GalleryPage } from "@veca/content";
import { api } from "../../lib/api";
export type GalleryFilters = {
  search: string;
  sharing: string;
  tag: string;
  stage: string;
  segment: string;
  requestType: string;
  source: string;
  status: string;
  category: string;
  sort: string;
};
export const emptyGalleryFilters: GalleryFilters = {
  search: "",
  sharing: "",
  tag: "",
  stage: "",
  segment: "",
  requestType: "",
  source: "",
  status: "",
  category: "",
  sort: "newest",
};
export function useGallery(filters: GalleryFilters, page: number) {
  const [result, setResult] = useState<{ params: string; data: GalleryPage }>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [settled, setSettled] = useState("");
  const params = new URLSearchParams({
    ...filters,
    page: String(page),
  }).toString();
  const request = JSON.stringify([params, revision]);
  const loading = settled !== request;
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const timer = setTimeout(() => {
      api<GalleryPage>(`/admin/gallery/photos?${params}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setResult({ params, data });
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError((e as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSettled(request);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params, request]);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  return {
    data: result?.data,
    current: result?.params === params,
    loading,
    error: loading ? "" : error,
    refresh,
  };
}
