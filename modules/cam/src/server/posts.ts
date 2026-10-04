import fluidnc from "../../posts/fluidnc.json";
import grbl from "../../posts/grbl.json";
import grblhal from "../../posts/grblhal.json";
import linuxcnc from "../../posts/linuxcnc.json";
import mach from "../../posts/mach.json";
import marlin from "../../posts/marlin.json";
import { validatePost, type Post } from "../post/schema.js";

function shipped(value: unknown): Post {
  const problems = validatePost(value);
  if (problems.length) throw new Error(problems.join("\n"));
  return value as Post;
}

export const POSTS: ReadonlyMap<string, Post> = new Map(
  [fluidnc, grbl, grblhal, linuxcnc, mach, marlin]
    .map(shipped)
    .map((post) => [post.id, post]),
);
