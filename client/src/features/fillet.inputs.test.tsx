import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FilletFeature } from "@rockett/shared";
import { fillet } from "./fillet";
import { createFeatureInputs } from "./registry";

const original: FilletFeature = {
  id: "fillet-input",
  type: "fillet",
  filletType: "equalDistance",
  name: "Fillet",
  suppressed: false,
  radius: 2.5,
  tangentChain: false,
  edges: [{ kind: "edge", bodyId: "body-input", edgeName: "edge-input" }],
};

describe("typed Fillet inputs", () => {
  it.each([
    ["equalDistance", ["Type", "Radius (mm)"]],
    ["twoDistances", ["Type", "Distance 1 (mm)", "Distance 2 (mm)", "Flip"]],
  ] as const)("shows the %s fields", (filletType, labels) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createFeatureInputs(fillet, { filletType }).renderForm(() => {}),
    );
    expect(
      [...host.querySelectorAll("label.field > span")]
        .map((span) => span.textContent)
        .filter((text) => text !== "Tangent chain"),
    ).toEqual(labels);
  });

  it("switching a prefilled type builds only the new type's fields", () => {
    const two: FilletFeature = {
      ...original,
      filletType: "twoDistances",
      distance2: 4,
      flip: true,
    };
    const { params, selection } = fillet.prefill!(two);
    expect(createFeatureInputs(fillet, params).build(selection)).toEqual(two);
    expect(
      createFeatureInputs(fillet, {
        ...params,
        filletType: "equalDistance",
      }).build(selection),
    ).toEqual(original);
    expect(
      createFeatureInputs(fillet, {
        ...fillet.prefill!(original).params,
        filletType: "twoDistances",
      }).build(selection),
    ).toEqual({
      ...original,
      filletType: "twoDistances",
      distance2: 2.5,
      flip: false,
    });
  });
});
