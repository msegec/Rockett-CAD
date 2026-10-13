import { spawnSync } from "node:child_process";
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const linter = join(homedir(), "masterrulez/scripts/lint-comments");
const FILE_LIMIT = 500;
const SHOW_LIMIT = 40;
const FUNCTION_LIMIT = 80;
const GROWS = "Cost-Grows";
const mode = process.argv[2] ?? "table";
const checked = mode === "--comments" ? "comment" : "cost";
const isolated = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function fail(message) {
  console.error(`${checked} check failed: ${message}`);
  process.exit(1);
}

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.error || !result.stdout)
    fail(`${command} did not run: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function git(args, cwd = root, env = process.env) {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return result.status === 0 ? result.stdout : null;
}

function mustGit(args, cwd, env) {
  return git(args, cwd, env) ?? fail(`git ${args.join(" ")} failed`);
}

function findBase() {
  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"])?.trim();
  if (!head) return null;
  const sha = git(["merge-base", "HEAD", "origin/main"])?.trim() || head;
  const body =
    sha === head ? "" : mustGit(["log", "--format=%B", `${sha}..HEAD`]);
  return {
    sha,
    short: sha.slice(0, 8),
    grows: new Set(
      [...body.matchAll(new RegExp(`^${GROWS}: (.+?)\\s*$`, "gm"))].map(
        (m) => m[1],
      ),
    ),
  };
}

function changes(base) {
  if (!base) return null;
  const sources = new Map();
  const fields = mustGit(["diff", "-M", "--name-status", "-z", base.sha]).split(
    "\0",
  );
  for (let i = 0; i + 1 < fields.length;) {
    const status = fields[i];
    if (status.startsWith("R")) {
      sources.set(fields[i + 2], fields[i + 1]);
      i += 3;
    } else {
      sources.set(fields[i + 1], status === "A" ? null : fields[i + 1]);
      i += 2;
    }
  }
  for (const path of mustGit([
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
  ]).split("\0"))
    if (path) sources.set(path, null);
  return sources;
}

function atBase(base, sources, paths, work) {
  const dir = mkdtempSync(join(tmpdir(), "rockett-base-"));
  try {
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(
        join(dir, path),
        mustGit(["cat-file", "blob", `${base.sha}:${sources.get(path)}`]),
      );
    }
    return work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lintSizes(cwd) {
  const dir = mkdtempSync(join(tmpdir(), "rockett-cost-"));
  const config = join(dir, "oxlintrc.json");
  const size = { max: 0, skipBlankLines: false, skipComments: false };
  writeFileSync(
    config,
    JSON.stringify({
      categories: { correctness: "off", suspicious: "off", perf: "off" },
      rules: {
        "max-lines": ["warn", size],
        "max-lines-per-function": ["warn", { ...size, IIFEs: true }],
      },
    }),
  );
  try {
    return JSON.parse(
      run(
        join(root, "node_modules/.bin/oxlint"),
        ["-c", config, "-f", "json"],
        cwd,
      ),
    ).diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deriveName(text, column) {
  const before = text
    .slice(0, column - 1)
    .replace(/\basync\s*$/, "")
    .trimEnd();
  const call = before.match(
    /([\w$.]+)(?:<[^()]*>)?\((["'`][^"'`]*["'`])?(?:\s*,)?$/,
  );
  if (call) {
    if (call[2]) return `${call[1]}(${call[2]})`;
    const assigned = before
      .slice(0, call.index)
      .match(/([\w$]+)\s*[:=]\s*(?:await\s+)?$/);
    return assigned ? assigned[1] : `${call[1]}()`;
  }
  return before.match(/([\w$]+)\s*[:=]$/)?.[1] ?? "anonymous";
}

function sourceFiles() {
  const isTest =
    /(^|\/)(test|tests|__tests__)\/|\.(test|spec|bench)\.[cm]?[jt]sx?$/;
  return new Set(
    run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .split("\0")
      .filter((path) => !isTest.test(path)),
  );
}

function measure(cwd, paths) {
  const files = new Map();
  for (const d of lintSizes(cwd)) {
    if (!paths.has(d.filename)) continue;
    const file = files.get(d.filename) ?? {
      path: d.filename,
      lines: 0,
      functions: [],
    };
    files.set(d.filename, file);
    const lines = Number(d.message.match(/\((\d+)\)/)?.[1]);
    const { line, column } = d.labels[0].span;
    if (d.code === "eslint(max-lines)") file.lines = lines;
    if (d.code === "eslint(max-lines-per-function)") {
      file.functions.push({
        line,
        column,
        lines,
        name: d.message.match(/`([^`]+)`/)?.[1],
      });
    }
  }
  for (const file of files.values()) {
    const text = readFileSync(join(cwd, file.path), "utf8").split("\n");
    for (const f of file.functions)
      f.name ??= deriveName(text[f.line - 1] ?? "", f.column);
    file.functions.sort((a, b) => b.lines - a.lines || a.line - b.line);
  }
  return [...files.values()];
}

function marked(files) {
  const entries = new Map();
  for (const file of files) {
    if (file.lines > FILE_LIMIT) entries.set(file.path, file.lines);
    const seen = new Map();
    for (const f of file.functions.toSorted((a, b) => a.line - b.line)) {
      if (f.lines <= FUNCTION_LIMIT) continue;
      const n = (seen.get(f.name) ?? 0) + 1;
      seen.set(f.name, n);
      entries.set(`${file.path} ${f.name}${n > 1 ? `#${n}` : ""}`, f.lines);
    }
  }
  return new Map(
    [...entries].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function pathOf(key) {
  return key.split(" ")[0];
}

function check() {
  const current = marked(measure(root, sourceFiles()));
  const base = findBase();
  const sources = changes(base);
  const changed = new Set(
    [...current.keys()]
      .map(pathOf)
      .filter((path) => !sources || sources.has(path)),
  );
  const traced = [...changed].filter((path) => sources?.get(path));
  const before = traced.length
    ? atBase(base, sources, traced, (dir) =>
        marked(measure(dir, new Set(traced))),
      )
    : new Map();
  let failed = false;
  for (const [key, lines] of current) {
    const path = pathOf(key);
    const was = before.get(key);
    if (!changed.has(path) || lines <= (was ?? 0)) continue;
    const from =
      was !== undefined
        ? `was ${was} at ${base.short}`
        : !base
          ? "no base commit"
          : sources.get(path)
            ? `under the limit at ${base.short}`
            : "new file";
    if (key === path && was !== undefined) {
      console.error(
        `cost check failed: ${key}: lines ${lines}, ${from}; a file over ${FILE_LIMIT} lines never grows, split it first`,
      );
      failed = true;
    } else if (!base?.grows.has(key)) {
      console.error(
        `cost check failed: ${key}: lines ${lines}, ${from}; tidy it, or commit it with the body line "${GROWS}: ${key}" and say why`,
      );
      failed = true;
    }
  }
  if (failed) process.exit(1);
  const functions = [...current.keys()].filter((key) =>
    key.includes(" "),
  ).length;
  console.log(
    `OK cost check against ${base?.short ?? "no base commit"}: ${current.size - functions} files over ${FILE_LIMIT} lines, ${functions} functions over ${FUNCTION_LIMIT}`,
  );
}

function commentCounts(cwd, env) {
  const output = run(process.execPath, [linter], cwd, env);
  if (!/^lint-comments: /m.test(output))
    fail(`lint-comments did not finish: ${output}`);
  return new Map(
    [...output.matchAll(/^(\S+): (\d+) comment lines? at /gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]),
  );
}

function comments() {
  if (!existsSync(linter))
    fail(
      "masterrulez lint-comments is missing; clone masterrulez to ~/masterrulez",
    );
  const current = commentCounts(root, process.env);
  const base = findBase();
  const sources = changes(base);
  const changed = [...current.keys()].filter(
    (path) => !sources || sources.has(path),
  );
  const traced = changed.filter((path) => sources?.get(path));
  const before = traced.length
    ? atBase(base, sources, traced, (dir) => {
        mustGit(["init", "-q"], dir, isolated);
        mustGit(["add", "-A"], dir, isolated);
        return commentCounts(dir, isolated);
      })
    : new Map();
  const rises = changed.filter(
    (path) => current.get(path) > (before.get(path) ?? 0),
  );
  for (const path of rises)
    console.error(
      `comment check failed: ${path}: comment lines ${current.get(path)}, was ${before.get(path) ?? "none"} at ${base?.short ?? "no base commit"}`,
    );
  if (rises.length)
    fail(
      "code carries no comments; delete the new ones and move the reason to the commit body",
    );
  const total = [...current.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `OK comment check against ${base?.short ?? "no base commit"}: ${current.size} files, ${total} lines`,
  );
}

function benchMedians() {
  const medians = new Map();
  for (const path of globSync("{*,modules/*}/dist/bench.json", {
    cwd: root,
  }).toSorted()) {
    let report;
    try {
      report = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch {
      fail(`${path} is not a vitest bench JSON report`);
    }
    for (const suite of report.testResults ?? [])
      for (const test of suite.assertionResults ?? [])
        for (const group of test.benchmarks ?? [])
          for (const task of group.tasks ?? []) {
            if (typeof task.latency?.p50 !== "number") continue;
            const key = `${dirname(dirname(path))} ${task.name.split(/\s+/)[0]}`;
            medians.set(key, [
              ...(medians.get(key) ?? []),
              `${task.latency.p50.toPrecision(3)} ms ${task.name}`,
            ]);
          }
  }
  return medians;
}

function table(files) {
  const medians = benchMedians();
  const used = new Set();
  const units = new Map();
  for (const file of files) {
    const module = file.path.match(/^modules\/[^/]+(?=\/)/)?.[0];
    const benchOf = (f) => `${module ?? file.path.split("/")[0]} ${f.name}`;
    const shown = file.functions.filter(
      (f) => f.lines > SHOW_LIMIT || medians.has(benchOf(f)),
    );
    const bigFunction = file.functions.some((f) => f.lines > FUNCTION_LIMIT);
    if (
      !module &&
      file.lines <= FILE_LIMIT &&
      !bigFunction &&
      !shown.some((f) => medians.has(benchOf(f)))
    )
      continue;
    const key = module ?? file.path;
    const unit = units.get(key) ?? {
      label: module ? `${module} (package)` : file.path,
      lines: 0,
      rows: [],
    };
    units.set(key, unit);
    unit.lines += file.lines;
    if (module && file.lines > FILE_LIMIT)
      unit.rows.push({
        label: `  ${file.path.slice(key.length + 1)}`,
        lines: file.lines,
      });
    for (const f of shown) {
      const where = module
        ? `${file.path.slice(key.length + 1)}:${f.line}`
        : `line ${f.line}`;
      if (medians.has(benchOf(f))) used.add(benchOf(f));
      unit.rows.push({
        label: `  ${f.name} (${where})`,
        lines: f.lines,
        fn: true,
        median: medians.get(benchOf(f))?.join("; ") ?? "no bench",
      });
    }
  }
  const rows = [];
  for (const unit of [...units.values()].toSorted(
    (a, b) => b.lines - a.lines,
  )) {
    rows.push({
      label: unit.label,
      lines: unit.lines,
      tidy: !unit.label.endsWith("(package)") && unit.lines > FILE_LIMIT,
    });
    for (const row of unit.rows.toSorted((a, b) => b.lines - a.lines)) {
      rows.push({
        ...row,
        tidy: row.lines > (row.fn ? FUNCTION_LIMIT : FILE_LIMIT),
      });
    }
  }
  const width = Math.max(...rows.map((r) => r.label.length), 16);
  const line = (label, lines, mark, median) =>
    `${label.padEnd(width)}  ${String(lines).padStart(5)}  ${mark.padEnd(4)}  ${median}`.trimEnd();
  console.log(line("file or function", "lines", "mark", "median"));
  for (const r of rows)
    console.log(line(r.label, r.lines, r.tidy ? "tidy" : "", r.median ?? ""));
  for (const [key, tasks] of medians) {
    if (!used.has(key))
      console.log(
        `bench without a function in ${key.split(" ")[0]}: ${tasks.join("; ")}`,
      );
  }
}

if (mode === "table") table(measure(root, sourceFiles()));
else if (mode === "--check") check();
else if (mode === "--comments") comments();
else fail("usage: node scripts/cost.mjs [--check | --comments]");
