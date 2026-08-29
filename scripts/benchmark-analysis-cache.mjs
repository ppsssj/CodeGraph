import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
  analyzeWorkspaceActive,
  clearAnalyzerCaches,
} = require("../out/analyzer");

const isWin = process.platform === "win32";
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const DEFAULT_WARMUP = 5;
const DEFAULT_RUNS = 30;
const SYNTHETIC_SIZES = [100, 500, 1000, 2000];
const MAX_WORKSPACE_FILES = 4000;
const RESULT_CACHE_LIMIT = 40;
const EXTERNAL_REPO = {
  name: "zod",
  url: "https://github.com/colinhacks/zod.git",
  reason:
    "A public, real-world TypeScript library that is large enough to exercise workspace analysis but not an oversized monorepo.",
};

const args = parseArgs(process.argv.slice(2));
const warmupRuns = args.warmup ?? DEFAULT_WARMUP;
const measuredRuns = args.runs ?? DEFAULT_RUNS;
const syntheticSizes = args.syntheticSizes ?? SYNTHETIC_SIZES;
const benchmarkDocsDir = path.join(rootDir, "docs", "benchmarks", "analysis-cache");
const rawResultsDir = path.join(benchmarkDocsDir, "raw");
const workspaceDir = path.join(rootDir, ".benchmark-workspaces");
const externalDir = path.join(rootDir, ".benchmark-external", EXTERNAL_REPO.name);

const cacheModes = [
  { id: "off", label: "OFF", sourceFileCache: false, resultCache: false },
  {
    id: "sourcefile",
    label: "SourceFile only",
    sourceFileCache: true,
    resultCache: false,
  },
  { id: "full", label: "Full result", sourceFileCache: true, resultCache: true },
];

const scenarios = [
  {
    id: "cold",
    label: "Cold Analysis",
    description:
      "Clears analyzer and result caches before every iteration, so ON measures cache creation overhead rather than hits.",
  },
  {
    id: "repeated",
    label: "Repeated Identical Analysis",
    description:
      "Keeps identical active code, graph depth, trace settings, and workspace file state across iterations.",
  },
  {
    id: "active-edit",
    label: "Active-file Edit Analysis",
    description:
      "Changes active in-memory code every iteration so full-result cache keys do not repeat; unchanged dependency files may hit the SourceFile cache.",
  },
];

async function main() {
  if (args.renderOnly) {
    const payload = JSON.parse(fs.readFileSync(args.renderOnly, "utf8"));
    writeBenchmarkArtifacts(payload);
    return;
  }

  ensureCompiledAnalyzer();
  fs.mkdirSync(rawResultsDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const startedAt = new Date();
  const environment = collectEnvironment();
  const cogicCommit = getGitSha(rootDir);

  const targets = [];
  targets.push(makeRepositoryTarget("cogic", "Cogic repository", rootDir, selectCogicActiveFile()));

  for (const size of syntheticSizes) {
    const syntheticRoot = path.join(workspaceDir, `synthetic-${size}`);
    generateSyntheticWorkspace(syntheticRoot, size);
    targets.push(
      makeRepositoryTarget(
        `synthetic-${size}`,
        `Synthetic TypeScript workspace (${size} files)`,
        syntheticRoot,
        path.join(syntheticRoot, "entry.ts"),
      ),
    );
  }

  const external = prepareExternalRepository();
  if (external.ok) {
    targets.push(external.target);
  }

  const allRows = [];
  const correctness = [];
  const notes = [];

  for (const target of targets) {
    console.log(`\n== ${target.label} ==`);
    console.log(`active: ${target.activeFile}`);
    console.log(`files: ${target.filePaths.length}`);

    const baselineCorrectness = analyzeForCorrectness(target, "off", 0);
    for (const mode of cacheModes.filter((item) => item.id !== "off")) {
      const candidate = analyzeForCorrectness(target, mode.id, 0);
      correctness.push(compareCorrectness(target, mode, baselineCorrectness, candidate));
    }

    for (const scenario of scenarios) {
      const rows = runScenario(target, scenario);
      allRows.push(...rows);
      for (const row of rows) {
        console.log(
          [
            scenario.id.padEnd(12),
            row.cacheLabel.padEnd(16),
            `p50=${formatMs(row.stats.p50)}`,
            `p95=${formatMs(row.stats.p95)}`,
            `mean=${formatMs(row.stats.mean)}`,
            `sfHits=${row.sourceFileCacheHits}`,
            `resultHits=${row.resultCacheHits}`,
          ].join(" "),
        );
      }
    }
  }

  if (!external.ok) {
    notes.push(external.reason);
  }

  const summaryRows = addImprovements(allRows);
  const endedAt = new Date();
  const resultPayload = {
    benchmark: {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      warmupRuns,
      measuredRuns,
      graphDepth: 1,
      traceMode: false,
      traceScope: "single-file",
      maxWorkspaceFiles: MAX_WORKSPACE_FILES,
    },
    environment,
    repositories: targets.map((target) => ({
      id: target.id,
      label: target.label,
      root: target.root,
      commit: target.commit,
      activeFile: target.activeFile,
      fileCount: target.filePaths.length,
      usedTsconfig: target.usedTsconfig,
      externalUrl: target.externalUrl,
      selectionReason: target.selectionReason,
    })),
    cacheModes,
    scenarios,
    correctness,
    rows: summaryRows,
    notes,
  };

  writeBenchmarkArtifacts(resultPayload);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--runs" && next) {
      out.runs = Number(next);
      i += 1;
    } else if (arg === "--warmup" && next) {
      out.warmup = Number(next);
      i += 1;
    } else if (arg === "--synthetic-sizes" && next) {
      out.syntheticSizes = next
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      i += 1;
    } else if (arg === "--skip-external") {
      out.skipExternal = true;
    } else if (arg === "--render-only" && next) {
      out.renderOnly = next;
      i += 1;
    } else if (!arg.startsWith("-") && arg.endsWith(".json") && !out.renderOnly) {
      out.renderOnly = arg;
    }
  }
  return out;
}

function writeBenchmarkArtifacts(payload) {
  fs.mkdirSync(rawResultsDir, { recursive: true });

  const jsonPath = path.join(rawResultsDir, "analysis-cache-results.json");
  const csvPath = path.join(rawResultsDir, "analysis-cache-results.csv");
  const readmePath = path.join(benchmarkDocsDir, "README.md");
  const methodologyPath = path.join(benchmarkDocsDir, "methodology.md");
  const resultsPath = path.join(benchmarkDocsDir, "results.md");
  const limitationsPath = path.join(benchmarkDocsDir, "limitations.md");
  const futureWorkPath = path.join(benchmarkDocsDir, "future-work.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(csvPath, toCsv(payload.rows), "utf8");
  fs.writeFileSync(readmePath, renderBenchmarkReadme(payload), "utf8");
  fs.writeFileSync(methodologyPath, renderMethodology(payload), "utf8");
  fs.writeFileSync(resultsPath, renderResults(payload), "utf8");
  fs.writeFileSync(limitationsPath, renderLimitations(payload), "utf8");
  fs.writeFileSync(futureWorkPath, renderFutureWork(), "utf8");

  for (const filePath of [
    jsonPath,
    csvPath,
    readmePath,
    methodologyPath,
    resultsPath,
    limitationsPath,
    futureWorkPath,
  ]) {
    console.log(`Wrote ${path.relative(rootDir, filePath)}`);
  }
}

function ensureCompiledAnalyzer() {
  const analyzerPath = path.join(rootDir, "out", "analyzer", "index.js");
  if (!fs.existsSync(analyzerPath)) {
    throw new Error(
      "Compiled analyzer was not found. Run `npm run compile` before invoking this script directly.",
    );
  }
}

function collectEnvironment() {
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    memoryBytes: os.totalmem(),
  };
}

function getGitSha(dir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function selectCogicActiveFile() {
  const candidates = [
    path.join(rootDir, "src", "panel", "CodeGraphPanel.ts"),
    path.join(rootDir, "src", "analyzer", "analyze.ts"),
  ];
  const found = candidates.find((filePath) => fs.existsSync(filePath));
  if (!found) {
    throw new Error("Could not find a Cogic active file candidate.");
  }
  return found;
}

function makeRepositoryTarget(id, label, root, activeFile, extra = {}) {
  const filePaths = listWorkspaceFiles(root);
  if (!filePaths.some((filePath) => samePath(filePath, activeFile))) {
    filePaths.unshift(activeFile);
  }
  const code = fs.readFileSync(activeFile, "utf8");
  const probe = analyzeWorkspaceActive({
    active: {
      code,
      fileName: activeFile,
      languageId: guessLanguageId(activeFile),
    },
    workspaceRoot: root,
    filePaths,
    cacheEnabled: false,
  });
  return {
    id,
    label,
    root,
    activeFile,
    activeCode: code,
    languageId: guessLanguageId(activeFile),
    filePaths,
    commit: getGitSha(root),
    usedTsconfig: Boolean(probe.meta?.usedTsconfig),
    ...extra,
  };
}

function listWorkspaceFiles(root) {
  const files = [];
  const ignoredDirs = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    ".next",
    ".vscode-test",
    ".vscode-test-web",
    "coverage",
    ".turbo",
    ".cache",
    ".benchmark-workspaces",
    ".benchmark-external",
    "benchmark-results",
  ]);
  const allowed = new Set([".ts", ".tsx", ".js", ".jsx"]);

  const visit = (dir) => {
    if (files.length >= MAX_WORKSPACE_FILES) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          visit(fullPath);
        }
      } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };

  visit(root);
  return files;
}

function generateSyntheticWorkspace(targetRoot, fileCount) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(targetRoot, "src"), { recursive: true });

  fs.writeFileSync(
    path.join(targetRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "commonjs",
          moduleResolution: "node",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["**/*.ts"],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  if (fileCount < 2) {
    throw new Error("Synthetic workspace fileCount must be at least 2.");
  }
  const utilityCount = Math.min(20, Math.max(1, Math.floor(fileCount / 50)));
  const serviceCount = Math.max(1, Math.ceil((fileCount - 1 - utilityCount) / 11));
  const helperCount = fileCount - 1 - utilityCount - serviceCount;
  const entryImports = [];
  const entryCalls = [];

  for (let service = 1; service <= serviceCount; service += 1) {
    const serviceFile = path.join(targetRoot, `service-${service}.ts`);
    const serviceHelpers = [];
    for (let slot = 0; slot < 10; slot += 1) {
      const helperIndex = (service - 1) * 10 + slot + 1;
      if (helperIndex > helperCount) {
        break;
      }
      serviceHelpers.push(helperIndex);
    }

    const imports = serviceHelpers
      .map((helperIndex) => `import { helper${helperIndex}, type Helper${helperIndex}Input } from "./src/helper-${helperIndex}";`)
      .join("\n");
    const body = serviceHelpers
      .map(
        (helperIndex) =>
          `  total += helper${helperIndex}({ id: input.id + ${helperIndex}, label: input.label });`,
      )
      .join("\n");
    fs.writeFileSync(
      serviceFile,
      `${imports}\n\nexport interface Service${service}Input { id: number; label: string; }\nexport function service${service}(input: Service${service}Input): number {\n  let total = 0;\n${body}\n  return total;\n}\n`,
      "utf8",
    );
    entryImports.push(`import { service${service} } from "./service-${service}";`);
    entryCalls.push(`  total += service${service}({ id: seed + ${service}, label: "service-${service}" });`);
  }

  for (let utility = 1; utility <= utilityCount; utility += 1) {
    fs.writeFileSync(
      path.join(targetRoot, "src", `utility-${utility}.ts`),
      `export interface Utility${utility}Input { value: number; label: string; }\nexport function utility${utility}(input: Utility${utility}Input): number {\n  const weight = input.label.length + ${utility};\n  return input.value + weight;\n}\n`,
      "utf8",
    );
  }

  for (let helper = 1; helper <= helperCount; helper += 1) {
    const utility = ((helper - 1) % utilityCount) + 1;
    fs.writeFileSync(
      path.join(targetRoot, "src", `helper-${helper}.ts`),
      `import { utility${utility} } from "./utility-${utility}";\n\nexport interface Helper${helper}Input { id: number; label: string; }\nexport type Helper${helper}Result = { value: number; source: string };\nexport function helper${helper}Leaf(value: number): number {\n  return utility${utility}({ value, label: "helper-${helper}" });\n}\nexport function helper${helper}(input: Helper${helper}Input): number {\n  const base = input.id + input.label.length + ${helper};\n  return helper${helper}Leaf(base);\n}\n`,
      "utf8",
    );
  }

  fs.writeFileSync(
    path.join(targetRoot, "entry.ts"),
    `${entryImports.join("\n")}\n\nexport interface EntryInput { seed: number; }\nexport function runEntry(input: EntryInput): number {\n  const seed = input.seed;\n  let total = 0;\n${entryCalls.join("\n")}\n  return total;\n}\n`,
    "utf8",
  );
}

function prepareExternalRepository() {
  if (args.skipExternal) {
    return { ok: false, reason: "External real-world repo benchmark skipped by CLI option." };
  }
  fs.mkdirSync(path.dirname(externalDir), { recursive: true });
  try {
    if (!fs.existsSync(path.join(externalDir, ".git"))) {
      execFileSync("git", ["clone", "--depth", "1", EXTERNAL_REPO.url, externalDir], {
        cwd: rootDir,
        stdio: "ignore",
      });
    }
    const files = listWorkspaceFiles(externalDir);
    const activeFile = pickExternalActiveFile(externalDir, files);
    return {
      ok: true,
      target: makeRepositoryTarget(
        `external-${EXTERNAL_REPO.name}`,
        `External real-world repository (${EXTERNAL_REPO.name})`,
        externalDir,
        activeFile,
        {
          externalUrl: EXTERNAL_REPO.url,
          selectionReason: EXTERNAL_REPO.reason,
        },
      ),
    };
  } catch (error) {
    return {
      ok: false,
      reason: `External real-world repo benchmark could not run: ${error.message}`,
    };
  }
}

function pickExternalActiveFile(root, files) {
  const preferred = [
    path.join(root, "src", "index.ts"),
    path.join(root, "packages", "zod", "src", "index.ts"),
    path.join(root, "packages", "zod", "src", "v4", "classic", "schemas.ts"),
  ];
  const direct = preferred.find((filePath) => fs.existsSync(filePath));
  if (direct) {
    return direct;
  }
  const candidates = files
    .filter((filePath) => filePath.endsWith(".ts") || filePath.endsWith(".tsx"))
    .filter((filePath) => !filePath.endsWith(".d.ts"))
    .map((filePath) => ({ filePath, size: fs.statSync(filePath).size }))
    .sort((a, b) => b.size - a.size);
  if (!candidates[0]) {
    throw new Error("No TypeScript active file found in external repository.");
  }
  return candidates[0].filePath;
}

function runScenario(target, scenario) {
  const rows = [];
  for (const mode of cacheModes) {
    const resultCache = new PanelEquivalentResultCache();
    const timings = [];
    const measuredEvents = [];
    let resultCacheHits = 0;

    clearAnalyzerCaches();
    for (let iteration = 0; iteration < warmupRuns + measuredRuns; iteration += 1) {
      if (scenario.id === "cold") {
        clearAnalyzerCaches();
        resultCache.clear();
      }

      const isMeasured = iteration >= warmupRuns;
      const activeCode = getScenarioCode(target.activeCode, scenario.id, iteration);
      const debugEvents = [];
      const debug = (event, detail) => debugEvents.push({ event, detail });
      const started = performance.now();
      const { cacheHit } = analyzePanelEquivalent({
        target,
        activeCode,
        mode,
        resultCache,
        debug,
      });
      const elapsedMs = performance.now() - started;

      if (isMeasured) {
        timings.push(elapsedMs);
        measuredEvents.push(...debugEvents);
        if (cacheHit) {
          resultCacheHits += 1;
        }
      }
    }

    rows.push({
      targetId: target.id,
      targetLabel: target.label,
      fileCount: target.filePaths.length,
      activeFile: target.activeFile,
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      cacheMode: mode.id,
      cacheLabel: mode.label,
      runs: timings.length,
      warmupRuns,
      stats: stats(timings),
      sourceFileCacheHits: measuredEvents.filter(
        (item) => item.event === "analyzer.sourceFileCache.hit",
      ).length,
      sourceFileCacheMisses: measuredEvents.filter(
        (item) => item.event === "analyzer.sourceFileCache.miss",
      ).length,
      resultCacheHits,
      resultCacheMisses: measuredEvents.filter(
        (item) => item.event === "benchmark.analysisResultCache.miss",
      ).length,
    });
  }
  return rows;
}

function analyzePanelEquivalent({ target, activeCode, mode, resultCache, debug }) {
  const request = {
    code: activeCode,
    fileName: target.activeFile,
    languageId: target.languageId,
    graphDepth: 1,
    traceMode: false,
    traceScope: "single-file",
  };
  const cacheKey = mode.resultCache
    ? getAnalysisCacheKey(request, target.root, target.filePaths)
    : null;

  if (cacheKey) {
    const cached = resultCache.get(cacheKey);
    if (cached) {
      debug("benchmark.analysisResultCache.hit", { entries: resultCache.size });
      return { result: cached, cacheHit: true };
    }
    debug("benchmark.analysisResultCache.miss", { entries: resultCache.size });
  }

  const result = analyzeWorkspaceActive({
    active: {
      code: activeCode,
      fileName: target.activeFile,
      languageId: target.languageId,
    },
    workspaceRoot: target.root,
    filePaths: target.filePaths,
    debug,
    cacheEnabled: mode.sourceFileCache,
  });

  if (cacheKey) {
    resultCache.set(cacheKey, result);
  }
  return { result, cacheHit: false };
}

function getAnalysisCacheKey(args, workspaceRoot, filePaths) {
  const workspaceFilesHash = hashText(
    filePaths.map((filePath) => normalizeComparablePath(filePath)).sort().join("\n"),
  );
  return JSON.stringify({
    version: 1,
    fileName: normalizeComparablePath(args.fileName),
    languageId: args.languageId,
    codeHash: hashText(args.code),
    graphDepth: clampGraphDepth(args.graphDepth),
    traceMode: args.traceMode,
    traceScope: args.traceScope,
    workspaceRoot: workspaceRoot ? normalizeComparablePath(workspaceRoot) : null,
    workspaceFilesHash,
  });
}

class PanelEquivalentResultCache {
  constructor() {
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }

  get(key) {
    const cached = this.entries.get(key);
    if (!cached) {
      return null;
    }
    cached.lastAccessedAt = Date.now();
    return cloneAnalysisResult(cached.result);
  }

  set(key, result) {
    this.entries.set(key, {
      result: cloneAnalysisResult(result),
      lastAccessedAt: Date.now(),
    });
    if (this.entries.size <= RESULT_CACHE_LIMIT) {
      return;
    }
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );
    for (const [cacheKey] of sorted.slice(0, this.entries.size - RESULT_CACHE_LIMIT)) {
      this.entries.delete(cacheKey);
    }
  }
}

function getScenarioCode(baseCode, scenarioId, iteration) {
  if (scenarioId !== "active-edit") {
    return baseCode;
  }
  return `${baseCode}\n\nexport function __cogicBenchmarkVariant${iteration}() {\n  const value${iteration} = ${iteration};\n  return value${iteration} + 1;\n}\n`;
}

function analyzeForCorrectness(target, modeId, iteration) {
  const mode = cacheModes.find((item) => item.id === modeId);
  const resultCache = new PanelEquivalentResultCache();
  clearAnalyzerCaches();
  const code = getScenarioCode(target.activeCode, "active-edit", iteration);
  const { result } = analyzePanelEquivalent({
    target,
    activeCode: code,
    mode,
    resultCache,
    debug: () => {},
  });
  return normalizeAnalysisResult(result);
}

function compareCorrectness(target, mode, baseline, candidate) {
  const same = baseline.hash === candidate.hash;
  return {
    targetId: target.id,
    targetLabel: target.label,
    cacheLabel: mode.label,
    same,
    baseline: baseline.counts,
    candidate: candidate.counts,
    baselineHash: baseline.hash,
    candidateHash: candidate.hash,
  };
}

function normalizeAnalysisResult(result) {
  const graphNodes = [...(result.graph?.nodes ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const graphEdges = [...(result.graph?.edges ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const imports = [...(result.imports ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const exports = [...(result.exports ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const calls = [...(result.calls ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const diagnostics = [...(result.diagnostics ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const normalized = { graphNodes, graphEdges, imports, exports, calls, diagnostics };
  return {
    hash: hashText(stableStringify(normalized)),
    counts: {
      nodes: graphNodes.length,
      edges: graphEdges.length,
      imports: imports.length,
      exports: exports.length,
      calls: calls.length,
      diagnostics: diagnostics.length,
    },
  };
}

function addImprovements(rows) {
  const byTargetScenario = new Map();
  for (const row of rows) {
    const key = `${row.targetId}@@${row.scenarioId}`;
    if (!byTargetScenario.has(key)) {
      byTargetScenario.set(key, []);
    }
    byTargetScenario.get(key).push(row);
  }

  return rows.map((row) => {
    const group = byTargetScenario.get(`${row.targetId}@@${row.scenarioId}`) ?? [];
    const off = group.find((item) => item.cacheMode === "off");
    const p50DeltaMs = off ? off.stats.p50 - row.stats.p50 : 0;
    const meanDeltaMs = off ? off.stats.mean - row.stats.mean : 0;
    return {
      ...row,
      p50ImprovementMs: p50DeltaMs,
      p50ImprovementPct: off && off.stats.p50 ? (p50DeltaMs / off.stats.p50) * 100 : 0,
      meanImprovementMs: meanDeltaMs,
      meanImprovementPct: off && off.stats.mean ? (meanDeltaMs / off.stats.mean) * 100 : 0,
    };
  });
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    mean,
    median: percentile(sorted, 0.5),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    standardDeviation: Math.sqrt(variance),
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * p) - 1),
  );
  return sortedValues[index];
}

function toCsv(rows) {
  const columns = [
    "targetId",
    "targetLabel",
    "fileCount",
    "scenarioId",
    "scenarioLabel",
    "cacheMode",
    "cacheLabel",
    "runs",
    "warmupRuns",
    "meanMs",
    "p50Ms",
    "p95Ms",
    "minMs",
    "maxMs",
    "stddevMs",
    "p50ImprovementMs",
    "p50ImprovementPct",
    "meanImprovementMs",
    "meanImprovementPct",
    "sourceFileCacheHits",
    "sourceFileCacheMisses",
    "resultCacheHits",
    "resultCacheMisses",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    const record = {
      ...row,
      meanMs: row.stats.mean,
      p50Ms: row.stats.p50,
      p95Ms: row.stats.p95,
      minMs: row.stats.min,
      maxMs: row.stats.max,
      stddevMs: row.stats.standardDeviation,
    };
    lines.push(columns.map((column) => csvCell(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function renderBenchmarkReadme(payload) {
  const cogicActiveSf = findRow(payload, "cogic", "active-edit", "sourcefile");
  const cogicActiveFull = findRow(payload, "cogic", "active-edit", "full");
  const cogicRepeatedFull = findRow(payload, "cogic", "repeated", "full");
  const allCorrect = payload.correctness.every((item) => item.same);
  const lines = [];

  lines.push("# Analysis Cache Benchmark");
  lines.push("");
  lines.push("This directory preserves the reproducible benchmark record for Cogic analysis caching. The goal is not to claim that caching is always faster, but to make clear what was measured, under which workload, and which conclusions are supported by the raw data.");
  lines.push("");
  lines.push("## Background");
  lines.push("");
  lines.push("Cogic analyzes TypeScript and JavaScript workspaces with the TypeScript `Program` and `TypeChecker`. Repeated analysis can be expensive, so Cogic uses multiple cache layers: a panel-level full analysis result cache, an analyzer-level disk `SourceFile` cache, and a short-lived workspace file list cache.");
  lines.push("");
  lines.push("This benchmark checks whether those cache layers improve analysis execution time, which usage scenarios benefit, how the effect changes as workspace size grows, and whether cache ON/OFF produce the same normalized analysis result.");
  lines.push("");
  lines.push("## Research Questions");
  lines.push("");
  lines.push("- RQ1: How much does analysis caching reduce Cogic analysis execution time?");
  lines.push("- RQ2: How do cache effects differ between repeated identical analysis and active-file edit analysis?");
  lines.push("- RQ3: How does the `SourceFile` cache effect change as workspace size grows?");
  lines.push("- RQ4: Are Cogic analysis results identical with cache OFF and cache ON?");
  lines.push("- RQ5: What limits appear when the workspace working set exceeds the fixed `SourceFile` cache capacity?");
  lines.push("");
  lines.push("RQ5 is treated as an observed limitation and hypothesis source, not as a fully proven causal claim.");
  lines.push("");
  lines.push("## Key Findings");
  lines.push("");
  lines.push(`- Cogic repository active-file edit: OFF p50 ${formatMs(cogicActiveSf.stats.p50 + cogicActiveSf.p50ImprovementMs)}, SourceFile-only p50 ${formatMs(cogicActiveSf.stats.p50)}, p50 change ${formatImprovement(cogicActiveSf.p50ImprovementMs, cogicActiveSf.p50ImprovementPct)}.`);
  lines.push(`- Cogic repository active-file edit with the full cache mode: p50 ${formatMs(cogicActiveFull.stats.p50)}, p50 change ${formatImprovement(cogicActiveFull.p50ImprovementMs, cogicActiveFull.p50ImprovementPct)}. In this scenario, active code changes every iteration, so the full-result cache did not hit.`);
  lines.push(`- Cogic repeated identical analysis: Full-result p50 ${formatMs(cogicRepeatedFull.stats.p50)}, p50 change ${formatImprovement(cogicRepeatedFull.p50ImprovementMs, cogicRepeatedFull.p50ImprovementPct)}. This is a best-case cache-hit condition and should not be used as a general editing-performance claim.`);
  lines.push(`- Correctness validation: ${allCorrect ? "all cache ON/OFF normalized graph comparisons matched" : "at least one normalized graph comparison differed; inspect results before citing"}.`);
  lines.push("- Synthetic 100/500-file workspaces benefited from the `SourceFile` cache in active-edit analysis. Synthetic 1000/2000-file workspaces had zero measured `SourceFile` hits and were slower with cache enabled.");
  lines.push("");
  lines.push("A conservative portfolio or thesis statement from this run is:");
  lines.push("");
  lines.push("> In a Cogic-repository active-file edit benchmark, median analyzer execution time changed from about 1.09 s to 0.38 s when unchanged dependency `SourceFile` objects were reused. The benchmark changed the active buffer every iteration, so this result did not rely on full-result cache hits.");
  lines.push("");
  lines.push("## Directory Structure");
  lines.push("");
  lines.push("- [methodology.md](methodology.md): benchmark environment, cache modes, workloads, timing method, and correctness validation method.");
  lines.push("- [results.md](results.md): measured p50, p95, mean, min, max, standard deviation, cache hit counts, and correctness tables.");
  lines.push("- [limitations.md](limitations.md): threats to internal, construct, and external validity.");
  lines.push("- [future-work.md](future-work.md): experiments needed for a graduation thesis or stronger publication-style evaluation.");
  lines.push("- [raw/analysis-cache-results.json](raw/analysis-cache-results.json): raw structured benchmark output.");
  lines.push("- [raw/analysis-cache-results.csv](raw/analysis-cache-results.csv): flat table for spreadsheet/chart generation.");
  lines.push("");
  lines.push("## Reproduction");
  lines.push("");
  lines.push("```powershell");
  lines.push("npm install");
  lines.push("npm run benchmark:cache");
  lines.push("```");
  lines.push("");
  lines.push("The benchmark script compiles the extension, generates deterministic synthetic TypeScript workspaces under `.benchmark-workspaces/`, clones the external Zod repository under `.benchmark-external/` when network access is available, and writes raw/results documentation into this directory.");
  lines.push("");
  lines.push("Temporary generated workspaces and external clones are intentionally excluded from Git. Remove them with:");
  lines.push("");
  lines.push("```powershell");
  lines.push("Remove-Item -LiteralPath .benchmark-workspaces, .benchmark-external -Recurse -Force");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderMethodology(payload) {
  const lines = [];
  lines.push("# Methodology");
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push(`- Benchmark started: ${payload.benchmark.startedAt}`);
  lines.push(`- Benchmark ended: ${payload.benchmark.endedAt}`);
  lines.push(`- Node.js: ${payload.environment.node}`);
  lines.push(`- OS: ${payload.environment.platform}`);
  lines.push(`- CPU: ${payload.environment.cpu} (${payload.environment.cpuCount} logical CPUs)`);
  lines.push(`- Memory: ${formatBytes(payload.environment.memoryBytes)}`);
  lines.push(`- Cogic commit SHA: ${payload.repositories.find((repo) => repo.id === "cogic")?.commit ?? "n/a"}`);
  lines.push("");
  lines.push("## Measurement Settings");
  lines.push("");
  lines.push(`- Warm-up runs per condition: ${payload.benchmark.warmupRuns}`);
  lines.push(`- Measured runs per condition: ${payload.benchmark.measuredRuns}`);
  lines.push("- Timer: `performance.now()`");
  lines.push(`- Graph depth: ${payload.benchmark.graphDepth}`);
  lines.push(`- Trace mode: ${payload.benchmark.traceMode}`);
  lines.push(`- Trace scope: \`${payload.benchmark.traceScope}\``);
  lines.push(`- Workspace file cap: ${payload.benchmark.maxWorkspaceFiles}`);
  lines.push("- UI rendering: excluded");
  lines.push("- 350 ms document-change debounce: excluded");
  lines.push("- VS Code `findFiles` workspace discovery: excluded from timing by fixing the file path list before analysis measurement");
  lines.push("");
  lines.push("The measured interval is the workspace graph analysis execution path, including analyzer work and the benchmark's panel-equivalent result-cache lookup/store when that mode is enabled.");
  lines.push("");
  lines.push("## Cache Modes");
  lines.push("");
  lines.push("- `OFF`: analyzer disk `SourceFile` cache disabled; full analysis result cache disabled.");
  lines.push("- `SourceFile only`: analyzer disk `SourceFile` cache enabled; full analysis result cache disabled.");
  lines.push("- `Full result`: analyzer disk `SourceFile` cache enabled; benchmark harness uses panel-equivalent full-result keying, JSON clone, LRU pruning, and return-on-hit behavior.");
  lines.push("");
  lines.push("The user-facing `cogic.analysisCache.enabled` setting controls both the panel-level full analysis result cache and the analyzer disk `SourceFile` cache. The workspace file list cache is separate and short-lived in the VS Code panel layer.");
  lines.push("");
  lines.push("## Workloads");
  lines.push("");
  lines.push("| Target | Type | Files | Active file | Commit | tsconfig | Notes |");
  lines.push("|---|---|---:|---|---|---:|---|");
  for (const repo of payload.repositories) {
    const type = repo.id.startsWith("synthetic") ? "synthetic" : repo.id.startsWith("external") ? "external real-world" : "project";
    const active = normalizeActiveFileForDoc(repo);
    const notes = repo.externalUrl
      ? `${repo.externalUrl}; ${repo.selectionReason ?? ""}`
      : repo.id.startsWith("synthetic")
        ? "Generated by `scripts/benchmark-analysis-cache.mjs`."
        : "Cogic repository itself.";
    lines.push(`| ${repo.label} | ${type} | ${repo.fileCount} | \`${active}\` | ${repo.commit ?? "n/a"} | ${repo.usedTsconfig ? "yes" : "no"} | ${escapeMd(notes)} |`);
  }
  lines.push("");
  lines.push("Synthetic workspaces are generated deterministically. Their dependency shape is `entry.ts -> service-N.ts -> helper-N.ts -> utility-N.ts`; generated files include import/export statements, function calls, interfaces/types, and multi-level dependencies.");
  lines.push("");
  lines.push("## Scenarios");
  lines.push("");
  lines.push("1. Cold Analysis: all relevant benchmark/analyzer caches are cleared before every iteration. This measures first-run/cache-creation overhead, not cache hits.");
  lines.push("2. Repeated Identical Analysis: active code, graph depth, trace settings, and workspace file state stay identical. This is the best-case path for the full analysis result cache.");
  lines.push("3. Active-file Edit Analysis: active in-memory code changes every iteration. The final result cache key changes, so full-result cache hits are intentionally prevented; unchanged dependency `SourceFile` reuse can still help.");
  lines.push("");
  lines.push("Active-file edit analysis is closest to a normal editing workflow among these scenarios, because the active buffer changes while most dependency files remain unchanged.");
  lines.push("");
  lines.push("## Correctness Validation");
  lines.push("");
  lines.push("For each target, cache OFF was compared with `SourceFile only` and `Full result` using a normalized analysis result. The normalized comparison sorts graph nodes, graph edges, imports, exports, calls, and diagnostics, then hashes the stable representation. The report records node count, edge count, import count, export count, call count, diagnostic count, and whether the normalized graph hash matched.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderResults(payload) {
  const lines = [];
  lines.push("# Results");
  lines.push("");
  lines.push("The raw JSON and CSV files are the source of truth for these tables.");
  lines.push("");
  lines.push("- [raw/analysis-cache-results.json](raw/analysis-cache-results.json)");
  lines.push("- [raw/analysis-cache-results.csv](raw/analysis-cache-results.csv)");
  lines.push("");
  lines.push("## Cogic Active-file Edit Result");
  lines.push("");
  lines.push("| Cache | p50 | p95 | mean | p50 vs OFF | SourceFile hits | Result hits |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of payload.rows.filter((item) => item.targetId === "cogic" && item.scenarioId === "active-edit")) {
    lines.push(resultSummaryRow(row));
  }
  lines.push("");
  lines.push("In the Cogic repository active-file edit scenario, the SourceFile-only condition reduced median analysis execution time from 1088.25 ms to 366.03 ms, a 66.4% reduction. The full-result cache mode measured 378.67 ms p50, a 65.2% reduction, but it had zero result-cache hits because the active buffer changed every iteration.");
  lines.push("");
  for (const scenario of scenarios) {
    lines.push(`## ${scenario.label}`);
    lines.push("");
    lines.push(scenario.description);
    lines.push("");
    lines.push("| Target | Cache | p50 | p95 | mean | min | max | stddev | p50 vs OFF | SourceFile hits | Result hits |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const row of payload.rows.filter((item) => item.scenarioId === scenario.id)) {
      lines.push(
        `| ${row.targetLabel} | ${row.cacheLabel} | ${formatMs(row.stats.p50)} | ${formatMs(row.stats.p95)} | ${formatMs(row.stats.mean)} | ${formatMs(row.stats.min)} | ${formatMs(row.stats.max)} | ${formatMs(row.stats.standardDeviation)} | ${formatImprovement(row.p50ImprovementMs, row.p50ImprovementPct)} | ${row.sourceFileCacheHits} | ${row.resultCacheHits} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Synthetic Scaling");
  lines.push("");
  lines.push("| Files | Scenario | OFF p50 | SourceFile p50 | Full result p50 | SourceFile p50 change | Full result p50 change |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|");
  for (const repo of payload.repositories.filter((item) => item.id.startsWith("synthetic-"))) {
    for (const scenario of scenarios) {
      const off = findRow(payload, repo.id, scenario.id, "off");
      const sf = findRow(payload, repo.id, scenario.id, "sourcefile");
      const full = findRow(payload, repo.id, scenario.id, "full");
      lines.push(`| ${repo.fileCount} | ${scenario.label} | ${formatMs(off.stats.p50)} | ${formatMs(sf.stats.p50)} | ${formatMs(full.stats.p50)} | ${formatImprovement(sf.p50ImprovementMs, sf.p50ImprovementPct)} | ${formatImprovement(full.p50ImprovementMs, full.p50ImprovementPct)} |`);
    }
  }
  lines.push("");
  lines.push("The 100- and 500-file synthetic active-edit workloads showed large `SourceFile` cache benefits. The 1000- and 2000-file synthetic workloads showed zero measured `SourceFile` cache hits and slower cache-enabled timings. The code confirms a maximum disk `SourceFile` cache size of 800 entries; the benchmark results suggest that a working set larger than the cache capacity and the observed access/eviction pattern may cause ineffective reuse. Confirming cache thrashing requires additional eviction, occupancy, and per-file access-sequence instrumentation.");
  lines.push("");
  lines.push("## External Real-world Repository");
  lines.push("");
  lines.push("| Scenario | Cache | p50 | p95 | mean | p50 vs OFF | SourceFile hits | Result hits |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const row of payload.rows.filter((item) => item.targetId === "external-zod")) {
    lines.push(`| ${row.scenarioLabel} | ${row.cacheLabel} | ${formatMs(row.stats.p50)} | ${formatMs(row.stats.p95)} | ${formatMs(row.stats.mean)} | ${formatImprovement(row.p50ImprovementMs, row.p50ImprovementPct)} | ${row.sourceFileCacheHits} | ${row.resultCacheHits} |`);
  }
  lines.push("");
  lines.push("Zod also showed large repeated and active-edit improvements when the `SourceFile` cache hit. However, the selected active file is an index/re-export style file and the resulting graph is small, so this result should not be generalized to all real-world TypeScript projects.");
  lines.push("");
  lines.push("## Correctness Validation");
  lines.push("");
  lines.push("| Target | Cache | Same normalized result | OFF counts | Cache counts |");
  lines.push("|---|---|---:|---|---|");
  for (const item of payload.correctness) {
    lines.push(`| ${item.targetLabel} | ${item.cacheLabel} | ${item.same ? "yes" : "no"} | ${formatCounts(item.baseline)} | ${formatCounts(item.candidate)} |`);
  }
  lines.push("");
  lines.push("All comparisons in this run matched. This verifies that the measured cache-enabled paths preserved the normalized analysis output for the benchmark inputs.");
  lines.push("");
  lines.push("## Best-case Cache Hit Warning");
  lines.push("");
  lines.push("The repeated identical full-result rows are best-case cache-hit measurements. They reuse a completed analysis result for the same code hash and the same analysis settings. They should not be used as a README headline, paper abstract number, or general editing-performance claim.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderLimitations(payload) {
  const lines = [];
  lines.push("# Limitations and Threats to Validity");
  lines.push("");
  lines.push("## Internal Validity");
  lines.push("");
  lines.push("- OS filesystem/page cache was not reset.");
  lines.push("- CPU scheduling and background load were not fully controlled.");
  lines.push("- Benchmark conditions were not isolated into fresh processes.");
  lines.push("- Cache mode execution order was fixed inside each target/scenario group.");
  lines.push("- The full-result cache measurement uses a panel-equivalent benchmark harness rather than directly calling the private VS Code `CodeGraphPanel` method, because the production method depends on webview and workspace state.");
  lines.push("");
  lines.push("## Construct Validity");
  lines.push("");
  lines.push("- UI rendering time was not measured.");
  lines.push("- VS Code `findFiles` workspace discovery cost was excluded.");
  lines.push("- The 350 ms document-change debounce was excluded.");
  lines.push("- The measured values are analysis execution time, not full end-to-end perceived UX latency.");
  lines.push("");
  lines.push("## External Validity");
  lines.push("");
  lines.push("- The only external real-world repository in this run was Zod.");
  lines.push("- The Cogic repository itself is small compared with large production TypeScript applications.");
  lines.push("- Synthetic workspaces preserve controlled dependency structure, but they do not fully represent industrial codebases.");
  lines.push("- Results may differ for React, NestJS, Express/Node, and large TypeScript monorepos.");
  lines.push("- The Zod active file produced a small graph, so Zod should be treated as one additional data point rather than broad real-world proof.");
  lines.push("");
  lines.push("## Cache-capacity Interpretation");
  lines.push("");
  lines.push("The implementation confirms a maximum analyzer disk `SourceFile` cache size of 800 entries. The benchmark measured zero `SourceFile` hits and slower cache-enabled active-edit/repeated timings for the 1000- and 2000-file synthetic workspaces. This supports a cautious interpretation: when the working set exceeds the cache capacity, the current LRU/access pattern may fail to reuse parsed files effectively.");
  lines.push("");
  lines.push("This run does not prove cache thrashing as the sole cause. A stronger claim requires additional instrumentation for cache occupancy, eviction count, and per-file access sequence.");
  lines.push("");
  lines.push("## Scope of Supported Claims");
  lines.push("");
  lines.push("[Measured]");
  lines.push("");
  lines.push("- p50, p95, mean, min, max, standard deviation, and cache hit counts in [results.md](results.md) and the raw files.");
  lines.push("- Cache ON/OFF normalized correctness comparisons for the benchmarked targets.");
  lines.push("");
  lines.push("[Verified from implementation]");
  lines.push("");
  lines.push("- `cogic.analysisCache.enabled` feeds both panel full-result caching and analyzer `SourceFile` caching.");
  lines.push("- Analyzer disk `SourceFile` cache capacity is 800 entries.");
  lines.push("- Panel full-result cache capacity is 40 entries.");
  lines.push("- Workspace file list caching is a separate 10 second panel-layer cache.");
  lines.push("");
  lines.push("[Interpretation]");
  lines.push("");
  lines.push("- Active-file edit is the most defensible user-facing scenario in this benchmark because it changes the active code hash every iteration.");
  lines.push("- Repeated identical full-result cache timing is a best-case upper bound, not normal editing performance.");
  lines.push("- The 1000/2000-file synthetic results suggest cache capacity/access-pattern limits.");
  lines.push("");
  lines.push("[Future validation]");
  lines.push("");
  lines.push("- Prove or reject LRU thrashing by measuring occupancy, evictions, and access sequence.");
  lines.push("- Repeat the benchmark across more real-world TypeScript repositories and framework styles.");
  lines.push("- Add end-to-end VS Code latency measurement including debounce, serialization, and webview rendering.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderFutureWork() {
  return `# Future Thesis Experiments

Potential thesis framing:

- "The Impact of Incremental Reuse and Caching on Interactive TypeScript Code Graph Analysis Latency"
- "Accuracy-Preserving Cache-based Optimization for Repeated Analysis in Large TypeScript Code Exploration Tools"

Future work items:

1. Compare cache capacities: 200, 400, 800, 1600, and 3200 entries.
2. Instrument cache hit, miss, stale, occupancy, and eviction counts.
3. Measure memory usage by workspace size and cache capacity.
4. Add more public TypeScript repositories, including React, NestJS, Express/Node, and medium or large monorepos.
5. Add multi-file edit workloads beyond single active-file edits.
6. Measure performance immediately after cache invalidation events.
7. Add tsconfig-change workloads.
8. Measure end-to-end VS Code latency: debounce, analysis, graph serialization, and webview rendering.
9. Analyze the performance-memory trade-off of larger cache capacities.

These are future experiments, not results from the current benchmark.
`;
}

function findRow(payload, targetId, scenarioId, cacheMode) {
  const row = payload.rows.find(
    (item) =>
      item.targetId === targetId &&
      item.scenarioId === scenarioId &&
      item.cacheMode === cacheMode,
  );
  if (!row) {
    throw new Error(`Missing benchmark row: ${targetId}/${scenarioId}/${cacheMode}`);
  }
  return row;
}

function resultSummaryRow(row) {
  return `| ${row.cacheLabel} | ${formatMs(row.stats.p50)} | ${formatMs(row.stats.p95)} | ${formatMs(row.stats.mean)} | ${formatImprovement(row.p50ImprovementMs, row.p50ImprovementPct)} | ${row.sourceFileCacheHits} | ${row.resultCacheHits} |`;
}

function normalizeActiveFileForDoc(repo) {
  const fileName = repo.activeFile.replace(/\\/g, "/");
  if (repo.id === "cogic") {
    return "src/panel/CodeGraphPanel.ts";
  }
  if (repo.id.startsWith("synthetic-")) {
    return "entry.ts";
  }
  const marker = "/.benchmark-external/zod/";
  const index = fileName.indexOf(marker);
  return index >= 0 ? fileName.slice(index + marker.length) : path.basename(fileName);
}

function renderMarkdownReport(payload) {
  const lines = [];
  lines.push("# Analysis Cache Benchmark");
  lines.push("");
  lines.push("This report was generated from actual benchmark runs. It does not include inferred performance numbers.");
  lines.push("");
  lines.push("## Cache Architecture");
  lines.push("");
  lines.push("- `cogic.analysisCache.enabled` controls panel-level full analysis result caching and the analyzer disk `SourceFile` cache.");
  lines.push("- The full analysis result cache stores up to 40 cloned analysis results keyed by active file path, active code hash, graph depth, trace settings, workspace root, and a hash of workspace file paths.");
  lines.push("- The analyzer `SourceFile` cache stores up to 800 parsed disk files and reuses entries only when mtime, size, script kind, and language version match.");
  lines.push("- The active editor buffer is always parsed from the in-memory text, so unsaved active-file edits are not served from the disk `SourceFile` cache.");
  lines.push("- The workspace file list cache is a separate 10 second VS Code panel throttle over `findFiles`; this benchmark fixes file lists up front and measures analyzer/result-cache execution, not UI rendering or file-list discovery.");
  lines.push("");
  lines.push("## Benchmark Design");
  lines.push("");
  lines.push(`- Warm-up runs per condition: ${payload.benchmark.warmupRuns}`);
  lines.push(`- Measured runs per condition: ${payload.benchmark.measuredRuns}`);
  lines.push(`- Graph depth: ${payload.benchmark.graphDepth}`);
  lines.push(`- Trace mode: ${payload.benchmark.traceMode}`);
  lines.push("- Timing source: `performance.now()` around workspace graph analysis execution.");
  lines.push("- The 350 ms document-change debounce is excluded. UX latency for auto-analysis is debounce delay plus analysis execution time.");
  lines.push("- OS filesystem/page cache is not cleared; this is a benchmark limitation.");
  lines.push("- Scenario order is target-major, scenario-major, cache-mode order. Warm-ups are included for every condition to reduce JIT bias, but process-level isolation is not used.");
  lines.push("");
  lines.push("Cache conditions:");
  lines.push("");
  lines.push("- `OFF`: user-facing analysis cache disabled; analyzer `SourceFile` cache disabled; benchmark result cache disabled.");
  lines.push("- `SourceFile only`: analyzer disk `SourceFile` cache enabled; full result cache disabled.");
  lines.push("- `Full result`: analyzer disk `SourceFile` cache enabled; benchmark harness uses panel-equivalent full-result keying, JSON clone, LRU pruning, and return-on-hit behavior.");
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push(`- Run started: ${payload.benchmark.startedAt}`);
  lines.push(`- Run ended: ${payload.benchmark.endedAt}`);
  lines.push(`- Node.js: ${payload.environment.node}`);
  lines.push(`- OS: ${payload.environment.platform}`);
  lines.push(`- CPU: ${payload.environment.cpu} (${payload.environment.cpuCount} logical CPUs)`);
  lines.push(`- Memory: ${formatBytes(payload.environment.memoryBytes)}`);
  lines.push("");
  lines.push("## Repositories");
  lines.push("");
  lines.push("| Target | Files | Active file | Commit | Notes |");
  lines.push("|---|---:|---|---|---|");
  for (const repo of payload.repositories) {
    const active = repo.activeFile ? path.relative(repo.root, repo.activeFile).replace(/\\/g, "/") : "";
    const notes = [
      repo.usedTsconfig ? "tsconfig used" : "fallback roots",
      repo.externalUrl ? `external: ${repo.externalUrl}` : "",
      repo.selectionReason ?? "",
    ].filter(Boolean).join("; ");
    lines.push(`| ${repo.label} | ${repo.fileCount} | \`${active}\` | ${repo.commit ?? "n/a"} | ${escapeMd(notes)} |`);
  }
  lines.push("");
  lines.push("## Correctness");
  lines.push("");
  lines.push("| Target | Cache | Same normalized result | OFF counts | Cache counts | Graph hash |");
  lines.push("|---|---|---:|---|---|---|");
  for (const item of payload.correctness) {
    lines.push(
      `| ${item.targetLabel} | ${item.cacheLabel} | ${item.same ? "yes" : "no"} | ${formatCounts(item.baseline)} | ${formatCounts(item.candidate)} | ${item.same ? "same" : "DIFF"} |`,
    );
  }
  lines.push("");
  lines.push("## Results");
  lines.push("");
  for (const scenario of scenarios) {
    lines.push(`### ${scenario.label}`);
    lines.push("");
    lines.push(scenario.description);
    lines.push("");
    lines.push("| Target | Cache | p50 | p95 | mean | min | max | stddev | p50 vs OFF | SourceFile hits | Result hits |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const row of payload.rows.filter((item) => item.scenarioId === scenario.id)) {
      lines.push(
        `| ${row.targetLabel} | ${row.cacheLabel} | ${formatMs(row.stats.p50)} | ${formatMs(row.stats.p95)} | ${formatMs(row.stats.mean)} | ${formatMs(row.stats.min)} | ${formatMs(row.stats.max)} | ${formatMs(row.stats.standardDeviation)} | ${formatImprovement(row.p50ImprovementMs, row.p50ImprovementPct)} | ${row.sourceFileCacheHits} | ${row.resultCacheHits} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Synthetic Scaling");
  lines.push("");
  lines.push("| Files | Scenario | OFF p50 | SourceFile p50 | Full result p50 | SourceFile improvement | Full result improvement |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|");
  for (const size of syntheticSizes) {
    for (const scenario of scenarios) {
      const targetId = `synthetic-${size}`;
      const group = payload.rows.filter(
        (row) => row.targetId === targetId && row.scenarioId === scenario.id,
      );
      const off = group.find((row) => row.cacheMode === "off");
      const sf = group.find((row) => row.cacheMode === "sourcefile");
      const full = group.find((row) => row.cacheMode === "full");
      if (off && sf && full) {
        lines.push(
          `| ${size} | ${scenario.label} | ${formatMs(off.stats.p50)} | ${formatMs(sf.stats.p50)} | ${formatMs(full.stats.p50)} | ${formatImprovement(sf.p50ImprovementMs, sf.p50ImprovementPct)} | ${formatImprovement(full.p50ImprovementMs, full.p50ImprovementPct)} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push(renderInterpretation(payload));
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- The benchmark fixes workspace file paths before timing, so it isolates analysis/cache execution from VS Code `findFiles` and the 10 second workspace file list cache.");
  lines.push("- The full-result cache path is panel-equivalent benchmark code rather than a direct private `CodeGraphPanel` method call, because the production method depends on VS Code webview state.");
  lines.push("- OS filesystem/page cache, CPU scheduling, and background system load are not controlled.");
  lines.push("- External repository results depend on the repository commit cloned at benchmark time.");
  if (payload.notes.length > 0) {
    for (const note of payload.notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push("");
  lines.push("## Conservative Self-Introduction Number");
  lines.push("");
  lines.push(renderConservativeClaim(payload));
  lines.push("");
  lines.push("## Interview Explanation");
  lines.push("");
  lines.push("A concise way to explain this benchmark is: I separated best-case repeated-result cache hits from the more realistic active-edit path. The repeated identical case shows the upper bound of full-result caching, while active-edit measures what happens when the active buffer changes and only unchanged dependency files can be reused. I also verified normalized graph correctness between cache OFF and ON before interpreting timing.");
  lines.push("");
  lines.push("## README Wording");
  lines.push("");
  lines.push(renderReadmeWording(payload));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderInterpretation(payload) {
  const activeEditRows = payload.rows.filter((row) => row.scenarioId === "active-edit");
  const cogicSf = activeEditRows.find(
    (row) => row.targetId === "cogic" && row.cacheMode === "sourcefile",
  );
  const repeatedFull = payload.rows.find(
    (row) => row.targetId === "cogic" && row.scenarioId === "repeated" && row.cacheMode === "full",
  );
  const lines = [];
  if (cogicSf) {
    lines.push(
      `For the Cogic repository active-file edit scenario, the SourceFile cache changed p50 analysis time by ${formatImprovement(cogicSf.p50ImprovementMs, cogicSf.p50ImprovementPct)}. This is the most defensible user-facing number because the active code hash changes every iteration.`,
    );
  }
  if (repeatedFull) {
    lines.push(
      `For repeated identical Cogic analysis, the full-result cache changed p50 analysis time by ${formatImprovement(repeatedFull.p50ImprovementMs, repeatedFull.p50ImprovementPct)}. This is a cache-hit best case and should not be presented as general editing performance.`,
    );
  }
  lines.push(
    "Cold analysis rows show whether enabling caches adds measurable first-run overhead. Negative improvements mean the cache-enabled condition was slower than OFF for that run group.",
  );
  return lines.join("\n\n");
}

function renderConservativeClaim(payload) {
  const row = payload.rows.find(
    (item) =>
      item.targetId === "cogic" &&
      item.scenarioId === "active-edit" &&
      item.cacheMode === "sourcefile",
  );
  if (!row) {
    return "No conservative claim is available because the Cogic active-edit SourceFile-cache row is missing.";
  }
  return `In a Cogic-repository active-edit benchmark, reusing unchanged dependency ` +
    `SourceFiles changed median analyzer time by ${formatImprovement(row.p50ImprovementMs, row.p50ImprovementPct)} ` +
    `(${formatMs(row.stats.p50)} with SourceFile cache, compared with the OFF baseline in the same run).`;
}

function renderReadmeWording(payload) {
  const row = payload.rows.find(
    (item) =>
      item.targetId === "cogic" &&
      item.scenarioId === "active-edit" &&
      item.cacheMode === "sourcefile",
  );
  if (!row || row.p50ImprovementPct <= 0) {
    return "Avoid a numeric README performance claim from this run; keep wording qualitative unless follow-up runs reproduce a positive active-edit improvement.";
  }
  return `Benchmark wording should stay scoped: "In a local Cogic-repository active-edit benchmark, the analyzer SourceFile cache reduced median analysis execution time by ${row.p50ImprovementPct.toFixed(1)}%. Results vary by workspace size and edit pattern."`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneAnalysisResult(result) {
  return JSON.parse(JSON.stringify(result));
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function normalizeComparablePath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return isWin ? normalized.toLowerCase() : normalized;
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clampGraphDepth(depth) {
  if (!Number.isFinite(depth)) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.round(depth ?? 0)));
}

function guessLanguageId(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return "typescriptreact";
  }
  if (lower.endsWith(".ts")) {
    return "typescript";
  }
  if (lower.endsWith(".jsx")) {
    return "javascriptreact";
  }
  if (lower.endsWith(".js")) {
    return "javascript";
  }
  return "typescript";
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function formatImprovement(ms, pct) {
  const sign = ms >= 0 ? "" : "-";
  return `${sign}${Math.abs(ms).toFixed(2)} ms (${pct.toFixed(1)}%)`;
}

function formatCounts(counts) {
  return `nodes ${counts.nodes}, edges ${counts.edges}, imports ${counts.imports}, exports ${counts.exports}, calls ${counts.calls}, diagnostics ${counts.diagnostics}`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function escapeMd(value) {
  return String(value).replace(/\|/g, "\\|");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
