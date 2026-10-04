import { act } from "react";
import { expect, it } from "vitest";
import { POSTS } from "../src/server/posts.js";
import { CAM_EXTENSION, type CamData } from "../src/shared/document.js";
import {
  exports,
  fetchMock,
  flush,
  library,
  mine,
  open,
  saved,
} from "./helpers/camClient.js";

const camSaves = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length;

async function exportNc(panel: Element) {
  await act(async () =>
    [...panel.querySelectorAll("button")]
      .find((b) => b.textContent === "Export")!
      .click(),
  );
  await flush();
}

it("lists a library post as unqualified and copies its latest version onto the picked setup on export", async () => {
  const panel = await open("NC Program", "rockett.cam.nc");
  const post = [...panel.querySelectorAll("label.field")]
    .find((l) => l.querySelector("span")?.textContent === "Post")!
    .querySelector("select")!;
  expect([...post.options].map((o) => o.textContent)).toEqual([
    ...[...POSTS.values()].map(({ label }) => label),
    "My GRBL (unqualified)",
  ]);
  await act(async () => {
    post.value = "user.my-grbl";
    post.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const before = saved.revision;
  await exportNc(panel);

  expect(camSaves()).toBe(1);
  const [setup] = (saved.extensions[CAM_EXTENSION]!.data as CamData).setups;
  expect(setup!.post).toEqual({ ...mine, libraryRef: { id: "user.my-grbl" } });
  const path = `/projects/p1/m/rockett/cam/nc/m1/user.my-grbl/perFile/${setup!.id}`;
  expect(exports).toEqual([{ path, revision: before + 1 }]);

  await exportNc(panel);
  expect(camSaves()).toBe(1);
  expect(exports).toEqual([
    { path, revision: before + 1 },
    { path, revision: before + 1 },
  ]);

  const replaced = { ...mine, label: "My GRBL 2" };
  library.posts = [replaced];
  await exportNc(panel);
  expect(camSaves()).toBe(2);
  const [again] = (saved.extensions[CAM_EXTENSION]!.data as CamData).setups;
  expect(again!.post).toEqual({
    ...replaced,
    libraryRef: { id: "user.my-grbl" },
  });
  expect(exports.at(-1)).toEqual({ path, revision: before + 2 });
});
