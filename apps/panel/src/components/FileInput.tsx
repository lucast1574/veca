import { useId, useState, type InputHTMLAttributes } from "react";
import { FileUp } from "lucide-react";
import { Field } from "./ui";
import "./file-input.css";

export function FileInput({
  label,
  hint,
  file,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "multiple"> & {
  label: string;
  hint?: string;
  file?: File | null;
}) {
  const id = useId();
  const [localFilename, setFilename] = useState("");
  const filename = file === undefined ? localFilename : file?.name || "";
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="ve-file-input">
        <FileUp size={20} aria-hidden="true" />
        <span>
          <strong aria-hidden="true">
            {filename ? "Cambiar archivo" : "Seleccionar archivo"}
          </strong>
          <small id={id + "-filename"} aria-live="polite">
            {filename || "Ningún archivo seleccionado"}
          </small>
        </span>
        <input
          {...props}
          id={id}
          aria-describedby={[props["aria-describedby"], id + "-filename"]
            .filter(Boolean)
            .join(" ")}
          type="file"
          onChange={(event) => {
            if (file === undefined)
              setFilename(event.target.files?.[0]?.name || "");
            onChange?.(event);
          }}
        />
      </div>
    </Field>
  );
}
