import { useId, useState, type InputHTMLAttributes } from "react";
import { FileUp } from "lucide-react";
import { Field } from "./ui";
import "./file-input.css";

export function FileInput({
  label,
  hint,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "multiple"> & {
  label: string;
  hint?: string;
}) {
  const id = useId();
  const [filename, setFilename] = useState("");
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="ve-file-input">
        <FileUp size={20} aria-hidden="true" />
        <span aria-hidden="true">
          <strong>
            {filename ? "Cambiar archivo" : "Seleccionar archivo"}
          </strong>
          <small>{filename || "Ningún archivo seleccionado"}</small>
        </span>
        <input
          {...props}
          id={id}
          type="file"
          onChange={(event) => {
            setFilename(event.target.files?.[0]?.name || "");
            onChange?.(event);
          }}
        />
      </div>
    </Field>
  );
}
