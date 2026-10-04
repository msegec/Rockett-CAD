import { createElement as h, type MouseEvent, type ReactNode } from "react";

type Menu = { onContextMenu?: (e: MouseEvent) => void };

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

export const empty = (text: string) =>
  h("div", { className: "tree-empty" }, text);

export const row = (
  { key, name, onContextMenu }: { key: string; name: string } & Menu,
  ...rest: ReactNode[]
) =>
  h(
    "div",
    { key, className: "tree-item", role: "listitem", onContextMenu },
    h("span", null, name),
    ...rest,
  );

export const tree = (
  { title, key = title, onContextMenu }: { title: string; key?: string } & Menu,
  ...children: ReactNode[]
) =>
  h(
    "div",
    { key, className: "tree-section" },
    h("div", { className: "tree-header", onContextMenu }, title),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": title },
      ...children,
    ),
  );
