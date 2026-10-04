import { createElement as h, Fragment, useState } from "react";
import type { ClientContext, UserDataEntry } from "@rockett/plugin-api";
import { POST_KIT_FILE, postKit } from "../post/kit.js";
import type { Post } from "../post/schema.js";
import { POST_MAX_BYTES } from "../shared/document.js";
import {
  banner,
  button,
  deleteQuestion,
  libraryOf,
  placeholder,
  reason,
  row,
  tree,
  unqualified,
  useStored,
} from "./libraryParts.js";

export function usePosts({ ui, request }: ClientContext) {
  const stored = useStored<Post>(request, "posts", "Posts");
  const { library, setLibrary, setError } = stored;
  const [pending, setPending] = useState(false);
  const save = async (
    failed: string,
    send: () => Promise<UserDataEntry | null>,
  ) => {
    setPending(true);
    try {
      const entry = await send();
      if (!entry) return;
      setLibrary(libraryOf<Post>(entry));
      setError(null);
    } catch (e) {
      setError(`${failed}: ${reason(e)}.`);
    } finally {
      setPending(false);
    }
  };
  const pick = () =>
    save("Post did not import", async () => {
      const file = await ui.pickFile({
        accept: ".json,application/json",
        maxBytes: POST_MAX_BYTES,
      });
      return (
        file &&
        request<UserDataEntry>("POST", "posts", {
          post: file.text,
          etag: library!.etag,
        })
      );
    });
  const remove = async (post: Post) => {
    if (await ui.confirm(deleteQuestion(post.label)))
      await save("Post did not delete", () =>
        request<UserDataEntry>("PUT", "posts", {
          data: library!.items.filter((p) => p.id !== post.id),
          etag: library!.etag,
        }),
      );
  };
  const rows = library?.items.map((post) =>
    row(
      { key: post.id, name: unqualified(post.label) },
      button(
        "Delete",
        `Delete ${post.label}`,
        pending,
        () => void remove(post),
      ),
    ),
  );
  return h(
    Fragment,
    { key: "post" },
    banner(stored.error),
    tree({ title: "Posts" }, placeholder("posts", stored, rows?.length), rows),
    library && button("Import post", "Import post", pending, () => void pick()),
    button("Download post kit", "Download post kit", false, () =>
      ui.download({
        fileName: POST_KIT_FILE,
        data: postKit(),
        type: "text/markdown",
      }),
    ),
  );
}
