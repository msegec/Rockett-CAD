import { createElement as h, type MouseEvent, type ReactNode } from "react";
import type { UserDataEntry } from "@rockett/plugin-api";

export type Library<T> = { items: T[]; etag: string | null };

export function libraryOf<T>(entry: UserDataEntry | null): Library<T> {
  if (entry?.readOnly)
    throw new Error("it was saved by a newer version of Rockett");
  return {
    items: (entry?.data as T[] | undefined) ?? [],
    etag: entry?.etag ?? null,
  };
}

type Menu = {
  onContextMenu?: (e: MouseEvent) => void;
  onClick?: () => void;
  selected?: boolean;
};

const marked = (className: string, selected?: boolean) =>
  selected ? `${className} selected` : className;

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
  { key, name, selected, ...handlers }: { key: string; name: string } & Menu,
  ...rest: ReactNode[]
) =>
  h(
    "div",
    {
      key,
      className: marked("tree-item", selected),
      role: "listitem",
      ...handlers,
    },
    h("span", null, name),
    ...rest,
  );

export const tree = (
  {
    title,
    key = title,
    aside,
    selected,
    ...handlers
  }: { title: string; key?: string; aside?: ReactNode } & Menu,
  ...children: ReactNode[]
) =>
  h(
    "div",
    { key, className: "tree-section" },
    h(
      "div",
      { className: marked("tree-header", selected), ...handlers },
      title,
      aside && " ",
      aside,
    ),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": title },
      ...children,
    ),
  );
