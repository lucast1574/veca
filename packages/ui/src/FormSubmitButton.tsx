"use client";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";

export type FormSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  validateForm?: (values: FormData) => boolean;
};

export function FormSubmitButton({
  validateForm,
  disabled,
  ...props
}: FormSubmitButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const validate = useRef(validateForm);
  const update = useRef<() => void>(undefined);
  const [ready, setReady] = useState(false);
  const formId = props.form;
  const noValidate = props.formNoValidate;

  useLayoutEffect(() => {
    validate.current = validateForm;
    update.current?.();
  });

  useLayoutEffect(() => {
    const form = button.current?.form;
    if (!form || noValidate) {
      setReady(true);
      return;
    }
    const refresh = () => {
      const requiredText = form.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >(
        'input[required]:enabled:not([type]),input[type="text"][required]:enabled,input[type="tel"][required]:enabled,textarea[required]:enabled',
      );
      setReady(
        form.matches(":valid") &&
          Array.from(requiredText).every(
            (field) =>
              !field.willValidate ||
              field.value.trim().length >= Math.max(1, field.minLength),
          ) &&
          !form.querySelector(
            '[role="combobox"][aria-required="true"][value=""]:enabled',
          ) &&
          (validate.current?.(new FormData(form)) ?? true),
      );
    };
    update.current = refresh;
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(form, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-required",
        "checked",
        "disabled",
        "max",
        "maxlength",
        "min",
        "minlength",
        "multiple",
        "pattern",
        "readonly",
        "required",
        "selected",
        "step",
        "type",
        "value",
      ],
    });
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    const reset = () => queueMicrotask(refresh);
    form.addEventListener("reset", reset);
    return () => {
      update.current = undefined;
      observer.disconnect();
      form.removeEventListener("input", refresh);
      form.removeEventListener("change", refresh);
      form.removeEventListener("reset", reset);
    };
  }, [formId, noValidate]);

  return (
    <button
      type="submit"
      {...props}
      ref={button}
      disabled={disabled || !ready}
    />
  );
}
