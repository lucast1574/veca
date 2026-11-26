import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import type { LeadAttachment } from "@veca/content";
import { ChevronLeft, ChevronRight, Download, Maximize2 } from "lucide-react";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/ui";
import { API_BASE } from "../../lib/api";

export function LeadDocumentThumbnail({
  file,
  onOpen,
}: {
  file: LeadAttachment;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="lead-document-thumbnail"
      aria-label={`Ver vista previa de ${file.name}`}
      onClick={onOpen}
    >
      <DocumentPreview file={file} thumbnail />
      <span className="lead-document-expand" aria-hidden="true">
        <Maximize2 size={15} />
      </span>
    </button>
  );
}

export function LeadDocumentPreview({
  file,
  onClose,
}: {
  file: LeadAttachment;
  onClose: () => void;
}) {
  return (
    <Modal
      title={file.name}
      size="wide"
      onClose={onClose}
      className="lead-document-viewer"
      footer={
        <footer className="ve-modal-actions">
          <a
            className="btn btn-ghost"
            href={API_BASE + file.url}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={16} aria-hidden="true" /> Descargar
          </a>
        </footer>
      }
    >
      <DocumentPreview file={file} />
    </Modal>
  );
}

function DocumentPreview({
  file,
  thumbnail = false,
}: {
  file: LeadAttachment;
  thumbnail?: boolean;
}) {
  const url = API_BASE + file.url;
  if (/\.pdf$/i.test(file.name))
    return <PdfPreview url={url} thumbnail={thumbnail} />;
  return (
    <DocumentImage
      url={url}
      name={thumbnail ? "" : file.name}
      thumbnail={thumbnail}
    />
  );
}

function DocumentImage({
  url,
  name,
  thumbnail,
}: {
  url: string;
  name: string;
  thumbnail: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="lead-document-preview-status">
      Vista previa no disponible
    </span>
  ) : (
    <img
      className="lead-document-preview-image"
      src={url}
      alt={name}
      loading={thumbnail ? "lazy" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

function PdfPreview({ url, thumbnail }: { url: string; thumbnail: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    async function open() {
      const [library, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      if (cancelled) return;
      library.GlobalWorkerOptions.workerSrc = worker.default;
      task = library.getDocument({
        url,
        withCredentials: true,
        disableWorkerRendering: true,
      });
      const document = await task.promise;
      if (!cancelled) setPdf(document);
    }
    void open().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
    };
  }, [url]);

  if (failed)
    return (
      <span className="lead-document-preview-status">
        Vista previa no disponible
      </span>
    );
  if (!pdf)
    return (
      <span className="lead-document-preview-status" role="status">
        Cargando vista previa…
      </span>
    );
  return (
    <>
      <PdfPage key={page} pdf={pdf} page={page} thumbnail={thumbnail} />
      {!thumbnail && pdf.numPages > 1 && (
        <nav
          aria-label="Páginas del documento"
          className="lead-document-page-nav"
        >
          <Button
            type="button"
            variant="ghost"
            aria-label="Página anterior"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <span aria-live="polite">
            Página {page} de {pdf.numPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            aria-label="Página siguiente"
            disabled={page === pdf.numPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </nav>
      )}
    </>
  );
}

function PdfPage({
  pdf,
  page,
  thumbnail,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  thumbnail: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    let rendering: RenderTask | undefined;
    async function renderPage() {
      const current = await pdf.getPage(page);
      const element = canvas.current;
      if (cancelled || !element) return;
      const size = current.getViewport({ scale: 1 });
      const resolution = thumbnail ? 520 : 1600;
      const viewport = current.getViewport({
        scale: resolution / Math.max(size.width, size.height),
      });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      rendering = current.render({
        canvas: element,
        viewport,
        background: "#fff",
      });
      await rendering.promise;
      if (!cancelled) setStatus("ready");
    }
    void renderPage().catch(() => {
      if (!cancelled) setStatus("failed");
    });
    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [pdf, page, thumbnail]);
  return (
    <>
      <canvas
        ref={canvas}
        hidden={status !== "ready"}
        className="lead-document-preview-image"
        aria-hidden={thumbnail || undefined}
        role={thumbnail ? undefined : "img"}
        aria-label={thumbnail ? undefined : `Página ${page} del PDF`}
      />
      {status !== "ready" && (
        <span className="lead-document-preview-status" role="status">
          {status === "failed"
            ? "Vista previa no disponible"
            : "Cargando vista previa…"}
        </span>
      )}
    </>
  );
}
