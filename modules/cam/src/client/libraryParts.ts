import { createElement as h, type ReactNode } from "react";

export const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const button = (
  text: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
) =>
  h(
    "button",
    { className: "btn", "aria-label": label, disabled, onClick },
    text,
  );

export const banner = (error: string | null) =>
  error && h("div", { className: "error-banner", role: "alert" }, error);

export const row = (key: string, name: string, ...rest: ReactNode[]) =>
  h(
    "div",
    { key, className: "tree-item", role: "listitem" },
    h("span", null, name),
    ...rest,
  );

export const tree = (title: string, ...children: ReactNode[]) =>
  h(
    "div",
    { key: title, className: "tree-section" },
    h("div", { className: "tree-header" }, title),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": title },
      ...children,
    ),
  );
