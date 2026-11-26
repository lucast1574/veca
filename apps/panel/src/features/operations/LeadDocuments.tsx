import { useState } from "react";
import { Download, FileText, Ruler, Upload } from "lucide-react";
import { quotationSchema, type LeadAttachment } from "@veca/content";
import { Button, Field } from "../../components/ui";
import { FileInput } from "../../components/FileInput";
import { api, API_BASE } from "../../lib/api";
import {
  WarehouseForm,
  WarehouseSelect,
  stringField,
} from "../warehouse/shared";
import { amount } from "../accounting/accounting-shared";
import { date } from "./shared";
import {
  LeadDocumentPreview,
  LeadDocumentThumbnail,
} from "./LeadDocumentPreview";
import "./lead-documents.css";

type Purpose = "plan" | "quotation";
export const isWorkDocument = (file: LeadAttachment) =>
  file.type === "plan" || file.type === "quotation";

export function LeadDocumentFiles({
  documents,
}: {
  documents: LeadAttachment[];
}) {
  const [preview, setPreview] = useState<LeadAttachment>();
  if (!documents.length) return null;
  const latestPlan = documents.find((file) => file.type === "plan")?.id;
  const latestQuotation = documents.find(
    (file) => file.type === "quotation",
  )?.id;
  return (
    <section
      className="ops-card lead-documents"
      aria-labelledby="lead-document-files-title"
    >
      <div className="ops-card-heading">
        <h2 id="lead-document-files-title">Planos y cotizaciones</h2>
      </div>
      <ul className="lead-document-file-list">
        {documents.map((file) => {
          const isPlan = file.type === "plan";
          const isLatest = file.id === (isPlan ? latestPlan : latestQuotation);
          const Icon = isPlan ? Ruler : FileText;
          return (
            <li key={file.id}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong>{file.name}</strong>
                <small>
                  {isPlan ? "Plano" : "Cotización"} · {date(file.createdAt)}
                  {isLatest && " · Última versión"}
                </small>
              </div>
              <div className="lead-document-file-actions">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Ver vista previa de ${file.name}`}
                  onClick={() => setPreview(file)}
                >
                  Ver
                </Button>
                <a
                  className="warehouse-link"
                  href={API_BASE + file.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Descargar ${file.name}`}
                >
                  <Download size={15} aria-hidden="true" /> Descargar
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {preview && (
        <LeadDocumentPreview
          file={preview}
          onClose={() => setPreview(undefined)}
        />
      )}
    </section>
  );
}

export function LeadDocuments({
  attachments,
  path,
  canUpload,
  canReadQuotation,
  onShowFiles,
  saved,
}: {
  attachments: LeadAttachment[];
  path: string;
  canUpload: boolean;
  canReadQuotation: boolean;
  onShowFiles: () => void;
  saved: (type: Purpose) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState<Purpose>();
  const [preview, setPreview] = useState<LeadAttachment>();
  return (
    <section
      className="ops-card lead-documents"
      aria-labelledby="lead-documents-title"
    >
      <header className="lead-documents-header">
        <div>
          <h2 id="lead-documents-title">Documentos de la obra</h2>
          <p>Última versión de cada documento.</p>
        </div>
        {attachments.some(
          (file) =>
            file.type === "plan" ||
            (canReadQuotation && file.type === "quotation"),
        ) && (
          <Button type="button" variant="ghost" onClick={onShowFiles}>
            Ver en Archivos
          </Button>
        )}
      </header>
      <div className="lead-document-grid">
        {(
          ["plan", ...(canReadQuotation ? ["quotation"] : [])] as Purpose[]
        ).map((type) => {
          const file = attachments.find((a) => a.type === type);
          const Icon = type === "plan" ? Ruler : FileText;
          return (
            <article key={type} className="lead-document-tile">
              <div className="lead-document-heading">
                <Icon size={21} aria-hidden="true" />
                <h3>{type === "plan" ? "Plano" : "Cotización"}</h3>
              </div>
              {file ? (
                <>
                  <LeadDocumentThumbnail
                    key={file.id}
                    file={file}
                    onOpen={() => setPreview(file)}
                  />
                  <strong className="lead-document-name">
                    {file.quotation?.reference || file.name}
                  </strong>
                  <small>
                    {file.quotation ? `${file.name} · ` : ""}
                    {date(file.createdAt)}
                  </small>
                  {file.quotation && (
                    <p>
                      Venta sin IGV{" "}
                      <b>{amount(file.quotation.salesNetCents)}</b>
                      <br />
                      Presupuesto de costos{" "}
                      <b>{amount(file.quotation.costBudgetCents)}</b>
                    </p>
                  )}
                </>
              ) : (
                <p className="hint">
                  {type === "plan"
                    ? "Adjunta el plano para que el equipo lo encuentre al trabajar."
                    : "Adjunta la cotización y sus valores para presupuestar la obra."}
                </p>
              )}
              <div className="lead-document-actions">
                {file && (
                  <a
                    className="warehouse-link"
                    href={API_BASE + file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={15} />
                    Descargar
                  </a>
                )}
                {canUpload && (
                  <Button variant="ghost" onClick={() => setPurpose(type)}>
                    <Upload size={15} />
                    {file ? "Nueva versión" : "Adjuntar"}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {preview && (
        <LeadDocumentPreview
          file={preview}
          onClose={() => setPreview(undefined)}
        />
      )}
      {purpose && (
        <UploadDocument
          type={purpose}
          path={path}
          close={() => setPurpose(undefined)}
          done={async () => {
            await saved(purpose);
            setPurpose(undefined);
          }}
        />
      )}
    </section>
  );
}
function UploadDocument({
  type,
  path,
  close,
  done,
}: {
  type: Purpose;
  path: string;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [net, setNet] = useState("");
  const [cost, setCost] = useState("");
  const [taxRate, setTaxRate] = useState("18");
  const [durationType, setDurationType] = useState("working");
  const cents = (value: string) => Math.round(Number(value) * 100);
  const netCents = cents(net),
    costCents = cents(cost),
    taxCents = Math.round((netCents * Number(taxRate)) / 100);
  return (
    <WarehouseForm
      title={type === "plan" ? "Adjuntar plano" : "Adjuntar cotización"}
      action="Guardar documento"
      wide={type === "quotation"}
      onClose={close}
      canSubmit={!!file}
      hasChanges={!!file || !!net || !!cost}
      save={async (form) => {
        if (!file) throw new Error("Selecciona un archivo.");
        if (file.size > 12 * 1024 * 1024)
          throw new Error("El archivo debe pesar como máximo 12 MB.");
        const body = new FormData();
        body.append("file", file);
        body.append("documentType", type);
        if (type === "quotation") {
          const result = quotationSchema.safeParse({
            reference: stringField(form, "reference"),
            date: stringField(form, "date"),
            validUntil: stringField(form, "validUntil"),
            currency: "PEN",
            salesNetCents: netCents,
            taxRate: Number(taxRate),
            taxCents,
            costBudgetCents: costCents,
            advanceCents: cents(stringField(form, "advance")),
            paymentTerms: stringField(form, "paymentTerms"),
            durationDays: Number(form.get("durationDays")),
            durationType,
            executionTerms: stringField(form, "executionTerms"),
            notes: stringField(form, "notes"),
          });
          if (!result.success)
            throw new Error(
              "Revisa los importes, la vigencia y las condiciones. El adelanto no puede superar el total cotizado.",
            );
          body.append("quotation", JSON.stringify(result.data));
        }
        await api(path + "/files", { method: "POST", body });
        await done();
      }}
    >
      <FileInput
        label="Archivo"
        hint="PDF o imagen (JPG, PNG, WebP o AVIF), hasta 12 MB. Las versiones anteriores se conservan en Archivos."
        accept="application/pdf,image/jpeg,image/png,image/webp,image/avif"
        required
        onChange={(e) => setFile(e.target.files?.[0])}
      />
      {type === "quotation" && (
        <>
          <section className="quotation-section">
            <h3>Documento y vigencia</h3>
            <div className="warehouse-grid quotation-document-grid">
              <Field label="Número o referencia">
                <input
                  name="reference"
                  required
                  maxLength={100}
                  placeholder="Ej.: COT-2026-042"
                />
              </Field>
              <Field label="Fecha de cotización">
                <input name="date" type="date" required />
              </Field>
              <Field label="Válida hasta">
                <input name="validUntil" type="date" required />
              </Field>
            </div>
          </section>
          <section className="quotation-section">
            <h3>Importes en soles</h3>
            <div className="warehouse-grid">
              <Field label="Venta cotizada sin IGV">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="9999999.99"
                  required
                  value={net}
                  onChange={(e) => setNet(e.target.value)}
                />
              </Field>
              <WarehouseSelect
                label="IGV de la cotización"
                value={taxRate}
                onChange={setTaxRate}
                options={[
                  { value: "18", label: "18 %" },
                  { value: "0", label: "Sin IGV (según documento)" },
                ]}
              />
              <Field
                label="Costo previsto de la obra sin IGV"
                hint="Incluye materiales, personal y demás costos previstos."
              >
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="9999999.99"
                  required
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </Field>
              <Field
                label="Adelanto acordado con IGV"
                hint="Escribe 0 si no se acordó un adelanto."
              >
                <input
                  name="advance"
                  type="number"
                  min="0"
                  step="0.01"
                  max={(netCents + taxCents) / 100}
                  required
                />
              </Field>
            </div>
            <dl className="quotation-totals">
              <div>
                <dt>IGV</dt>
                <dd>{amount(taxCents)}</dd>
              </div>
              <div>
                <dt>Total cotizado</dt>
                <dd>{amount(netCents + taxCents)}</dd>
              </div>
              <div>
                <dt>Ganancia prevista sin IGV</dt>
                <dd>
                  {net && cost ? amount(netCents - costCents) : "Por completar"}
                </dd>
              </div>
            </dl>
          </section>
          <section className="quotation-section">
            <h3>Condiciones acordadas</h3>
            <div className="warehouse-grid">
              <Field label="Plazo de ejecución en días">
                <input
                  name="durationDays"
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  required
                />
              </Field>
              <WarehouseSelect
                label="Tipo de días"
                value={durationType}
                onChange={setDurationType}
                options={[
                  { value: "working", label: "Días hábiles" },
                  { value: "calendar", label: "Días calendario" },
                ]}
              />
            </div>
            <Field label="Desde cuándo se cuenta el plazo">
              <input
                name="executionTerms"
                minLength={3}
                maxLength={1000}
                required
                placeholder="Ej.: Desde el adelanto y la aprobación de medidas"
              />
            </Field>
            <Field label="Condiciones de pago">
              <textarea
                name="paymentTerms"
                rows={2}
                minLength={3}
                maxLength={1000}
                required
                placeholder="Ej.: Adelanto del 50 % y saldo contra entrega"
              />
            </Field>
            <Field label="Alcance, exclusiones u observaciones (opcional)">
              <textarea name="notes" rows={2} maxLength={2000} />
            </Field>
          </section>
          <p className="hint">
            Estos valores serán la base del presupuesto y la proyección en
            Contabilidad. Adjuntar la cotización no emite una factura ni
            registra un cobro. Verifica que coincidan con el documento.
          </p>
        </>
      )}
    </WarehouseForm>
  );
}
