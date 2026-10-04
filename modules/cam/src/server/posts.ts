import { Type } from "typebox";
import fluidnc from "../../posts/fluidnc.json";
import grbl from "../../posts/grbl.json";
import grblhal from "../../posts/grblhal.json";
import linuxcnc from "../../posts/linuxcnc.json";
import mach from "../../posts/mach.json";
import marlin from "../../posts/marlin.json";
import { validatePost, type Post } from "../post/schema.js";
import {
  POST_MAX_BYTES,
  postBytes,
  USER_POST_PREFIX,
} from "../shared/document.js";

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

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function userPostProblem(text: string): string {
  const bytes = postBytes(text);
  if (bytes > POST_MAX_BYTES)
    return `is ${bytes} bytes, over the ${POST_MAX_BYTES} byte limit`;
  const value = parsed(text);
  if (value === undefined) return "is not JSON";
  return validatePost(value)[0] ?? "";
}

export function userPost(text: string): Post {
  const post = JSON.parse(text) as Post;
  return post.id.startsWith(USER_POST_PREFIX)
    ? post
    : { ...post, id: `${USER_POST_PREFIX}${post.id}` };
}

export const userPostText = Type.Refine(
  Type.String(),
  (text) => !userPostProblem(text),
  userPostProblem,
);
