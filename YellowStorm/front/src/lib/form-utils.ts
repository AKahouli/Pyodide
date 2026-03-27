import type { FieldErrors } from "react-hook-form";
import { toast } from "sonner";

/**
 * Scrolls to the first field with a validation error and shows a toast.
 * Works with both `register()`-based inputs (matched by `name` attr)
 * and controlled fields like Select (matched by `data-field` attr).
 *
 * Usage: `handleSubmit(onSuccess, scrollToFirstError)`
 */
export function scrollToFirstError(errors: FieldErrors) {
  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return;

  requestAnimationFrame(() => {
    // Try name attribute first (for registered inputs/textareas)
    let el: HTMLElement | null = document.querySelector(
      `[name="${firstKey}"]`,
    );
    // Fallback to data-field attribute (for controlled fields like Select)
    if (!el) {
      el = document.querySelector(`[data-field="${firstKey}"]`);
    }
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Try to focus the element or its first focusable child
      const focusable = el.matches("input, textarea, button") ? el
          : el.querySelector<HTMLElement>(
              'input, textarea, button[role="combobox"]',
            );
      if (focusable) {
        setTimeout(() => focusable.focus(), 300);
      }
    }
  });
}
