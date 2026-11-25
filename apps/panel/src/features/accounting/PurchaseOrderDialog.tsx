import { useRef, useState } from "react";
import "../warehouse/warehouse.css";
import { Plus, Trash2 } from "lucide-react";
import { purchaseInput, type Purchase, type Material } from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { SearchableSelect } from "@veca/ui/src/SearchableSelect";
import { api } from "../../lib/api";
import { unitName } from "../operations/shared";
import { MaterialForm } from "../warehouse/MaterialForm";
import {
  accountingPath,
  accountingPost,
  amount as money,
  recordId,
} from "./accounting-shared";
import {
  materialOptions,
  PickWork,
  stringField,
  WarehouseForm,
  type WorkOption,
} from "../warehouse/shared";
export const purchaseOrdersPath = accountingPath + "/purchase-orders";
export function PurchaseOrderDialog({
  materials,
  works,
  initialWork,
  requested,
  loadError,
  close,
  done,
}: {
  materials: Material[];
  works: WorkOption[];
  initialWork: string;
  requested?: Purchase;
  loadError?: string;
  close: () => void;
  done: (row: Purchase) => void;
}) {
  const editableLines = !requested || Boolean(requested.invoiceSource);
  const fixedSupplier = Boolean(
    requested?.invoiceSource &&
    requested.supplier &&
    requested.supplier !== "Proveedor por identificar",
  );
  const [createdMaterials, setCreatedMaterials] = useState<Material[]>([]);
  const [creatingFor, setCreatingFor] = useState<string>();
  const catalogue = [
    ...materials.filter(
      (material) => !createdMaterials.some((row) => row.id === material.id),
    ),
    ...createdMaterials,
  ];
  const [work, setWork] = useState(initialWork);
  const newLine = () => ({
    key: crypto.randomUUID(),
    materialId: "",
    requested: 0,
    label: "",
    quantity: "",
    price: "",
  });
  const [lines, setLines] = useState(() =>
    requested?.items.length
      ? requested.items.map((item) => ({
          key: item.materialId,
          materialId: item.materialId,
          requested: item.requested,
          label: `${item.sku} · ${item.name}`,
          quantity: item.ordered ? String(item.ordered) : "",
          price: item.unitCents ? String(item.unitCents / 100) : "",
        }))
      : [newLine()],
  );
  const total = lines.reduce(
    (sum, line) =>
      sum +
      Math.round(
        (Number(line.quantity) || 0) *
          Math.round((Number(line.price) || 0) * 100),
      ),
    0,
  );
  const difference = requested?.invoiceSource
    ? requested.invoiceSource.netCents - total
    : 0;
  const id = useRef(requested?.id || recordId());
  const parseDraft = (form: FormData) =>
    purchaseInput.safeParse({
      id: id.current,
      workId: work,
      supplier: fixedSupplier
        ? requested!.supplier
        : stringField(form, "supplier"),
      supplierRuc: requested?.invoiceSource
        ? requested.supplierRuc
        : stringField(form, "ruc"),
      reason: requested?.reason || stringField(form, "reason"),
      items: lines.map((item) => ({
        materialId: item.materialId,
        requested: requested ? item.requested : 0,
        ordered: Number(item.quantity),
        unitCents: Math.round(Number(item.price) * 100),
        reason:
          stringField(form, item.key + "-reason") ||
          requested?.reason ||
          stringField(form, "reason"),
      })),
    });
  return (
    <>
      <WarehouseForm
        title={
          requested?.invoiceSource
            ? "Completar materiales de la compra"
            : requested
              ? "Registrar compra de materiales"
              : "Nuevo pedido de materiales"
        }
        action={"Enviar a Almacén"}
        wide
        canSubmit={
          !loadError &&
          catalogue.length > 0 &&
          (!requested?.invoiceSource || difference === 0)
        }
        onClose={close}
        hasChanges={createdMaterials.length > 0}
        validateForm={(form) => parseDraft(form).success}
        save={async (form) => {
          const parsed = parseDraft(form);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            if (!issue.path.length) throw new Error(issue.message);
            throw new Error(
              "Revisa el proveedor, los códigos, las cantidades y el costo unitario.",
            );
          }
          done(
            requested
              ? await api<Purchase>(
                  `${purchaseOrdersPath}/${requested.id}/order`,
                  {
                    method: "PUT",
                    body: JSON.stringify(parsed.data),
                    signal: AbortSignal.timeout(25000),
                  },
                )
              : await accountingPost<Purchase>(purchaseOrdersPath, parsed.data),
          );
        }}
      >
        {requested?.invoiceSource && (
          <div className="purchase-source">
            {fixedSupplier && <strong>{requested.supplier}</strong>}
            <p className="hint">
              Factura {requested.invoiceSource.reference || "sin número"} ·{" "}
              {money(requested.invoiceSource.netCents)} sin IGV
              {requested.supplierRuc && (
                <span>RUC {requested.supplierRuc}</span>
              )}
            </p>
          </div>
        )}
        {!requested?.invoiceSource && (
          <p className="hint">
            Registra los materiales comprados. Almacén confirmará las cantidades
            recibidas.
          </p>
        )}
        {loadError && <Notice error>{loadError}</Notice>}
        {(!fixedSupplier || !requested?.invoiceSource) && (
          <div className="warehouse-grid">
            {!requested && (
              <PickWork
                works={works}
                value={work}
                onChange={setWork}
                allowGeneral
              />
            )}
            {!fixedSupplier && (
              <Field label="Proveedor">
                <input
                  name="supplier"
                  required
                  maxLength={150}
                  defaultValue={requested?.supplier}
                />
              </Field>
            )}
            {!requested?.invoiceSource && (
              <Field label="RUC del proveedor (opcional)">
                <input
                  name="ruc"
                  defaultValue={requested?.supplierRuc}
                  pattern="[0-9]{11}"
                  maxLength={11}
                  inputMode="numeric"
                />
              </Field>
            )}
            {!requested && (
              <Field label="Motivo del pedido">
                <input name="reason" required maxLength={500} />
              </Field>
            )}
          </div>
        )}
        <div className="warehouse-lines">
          {lines.map((line, index) => (
            <div className="warehouse-line" key={line.key}>
              <header>
                <strong>
                  {!editableLines ? line.label : `Material ${index + 1}`}
                </strong>
                {editableLines && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="btn btn-ghost purchase-catalogue-create"
                    onClick={() => setCreatingFor(line.key)}
                  >
                    <Plus size={14} aria-hidden="true" /> Registrar nuevo
                  </Button>
                )}
                {editableLines && lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Quitar material ${index + 1}`}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((row) => row.key !== line.key),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </header>
              {editableLines && (
                <Field
                  label="Código o material"
                  htmlFor={line.key + "-material"}
                >
                  <SearchableSelect
                    id={line.key + "-material"}
                    label="Código o material"
                    value={line.materialId}
                    options={materialOptions(catalogue)}
                    placeholder={
                      catalogue.length
                        ? "Buscar en el catálogo"
                        : "Registra el primer material"
                    }
                    onChange={(materialId) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key ? { ...row, materialId } : row,
                        ),
                      )
                    }
                  />
                </Field>
              )}
              <div className="warehouse-grid">
                <Field
                  label="Cantidad comprada"
                  hint={
                    line.materialId
                      ? `Unidad: ${unitName(catalogue.find((material) => material.id === line.materialId)?.unit || requested?.items.find((item) => item.materialId === line.materialId)?.unit || "unit")}`
                      : undefined
                  }
                >
                  <input
                    name={line.key + "-ordered"}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((rows) =>
                        rows.map((item) =>
                          item.key === line.key
                            ? { ...item, quantity: e.target.value }
                            : item,
                        ),
                      )
                    }
                    type="number"
                    required
                    min="0.001"
                    step="0.001"
                  />
                </Field>
                <Field label="Precio unitario sin IGV">
                  <input
                    name={line.key + "-cost"}
                    value={line.price}
                    onChange={(e) =>
                      setLines((rows) =>
                        rows.map((item) =>
                          item.key === line.key
                            ? { ...item, price: e.target.value }
                            : item,
                        ),
                      )
                    }
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <div className="purchase-detail-total">
          <strong>Total de materiales sin IGV: {money(total)}</strong>
          {requested?.invoiceSource && (
            <p>
              {difference === 0
                ? "El detalle coincide con la factura."
                : difference > 0
                  ? `Falta distribuir ${money(difference)} de la factura.`
                  : `El detalle supera la factura en ${money(-difference)}.`}
            </p>
          )}
        </div>
        {editableLines && (
          <Button
            type="button"
            variant="ghost"
            disabled={lines.length >= 40}
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            <Plus size={16} /> Añadir material
          </Button>
        )}
      </WarehouseForm>
      {creatingFor && (
        <MaterialForm
          close={() => setCreatingFor(undefined)}
          create={(data) =>
            accountingPost<Material>(
              accountingPath + "/purchase-materials",
              data,
            )
          }
          done={(material) => {
            setCreatedMaterials((current) => [
              ...current.filter((row) => row.id !== material.id),
              material,
            ]);
            setLines((current) =>
              current.map((line) =>
                line.key === creatingFor
                  ? { ...line, materialId: material.id }
                  : line,
              ),
            );
            setCreatingFor(undefined);
          }}
        />
      )}
    </>
  );
}
