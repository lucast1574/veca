import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  FormSubmitButton,
  type FormSubmitButtonProps,
} from "@veca/ui/src/FormSubmitButton";

type ButtonProps = FormSubmitButtonProps & {
  variant?: "primary" | "ghost" | "danger";
};

export function Button({
  children,
  variant = "primary",
  validateForm,
  ...props
}: ButtonProps) {
  if (props.type === "submit") {
    return (
      <FormSubmitButton
        className={`btn btn-${variant}`}
        validateForm={validateForm}
        {...props}
      >
        {children}
      </FormSubmitButton>
    );
  }
  return (
    <button className={`btn btn-${variant}`} {...props}>
      {children}
    </button>
  );
}
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const native =
    isValidElement(children) &&
    ["input", "textarea"].includes(String(children.type));
  const child = children as ReactElement<{ id?: string }>;
  const controlId =
    htmlFor || (native ? child.props.id || generatedId : undefined);
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {native ? cloneElement(child, { id: controlId }) : children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      role={error ? "alert" : "status"}
      className={`notice ${error ? "notice-error" : ""}`}
    >
      {children}
    </p>
  );
}
export function Status({
  published,
  changed = false,
}: {
  published: boolean;
  changed?: boolean;
}) {
  return (
    <span className={`status ${published ? "status-live" : ""}`}>
      {published
        ? changed
          ? "Cambios sin publicar"
          : "Publicado"
        : "Borrador"}
    </span>
  );
}
