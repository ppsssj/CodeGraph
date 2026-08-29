# Analysis Cache Benchmark

This directory preserves the reproducible benchmark record for Cogic analysis caching. The goal is not to claim that caching is always faster, but to make clear what was measured, under which workload, and which conclusions are supported by the raw data.

## Background

Cogic analyzes TypeScript and JavaScript workspaces with the TypeScript `Program` and `TypeChecker`. Repeated analysis can be expensive, so Cogic uses multiple cache layers: a panel-level full analysis result cache, an analyzer-level disk `SourceFile` cache, and a short-lived workspace file list cache.

This benchmark checks whether those cache layers improve analysis execution time, which usage scenarios benefit, how the effect changes as workspace size grows, and whether cache ON/OFF produce the same normalized analysis result.

## Research Questions

- RQ1: How much does analysis caching reduce Cogic analysis execution time?
- RQ2: How do cache effects differ between repeated identical analysis and active-file edit analysis?
- RQ3: How does the `SourceFile` cache effect change as workspace size grows?
- RQ4: Are Cogic analysis results identical with cache OFF and cache ON?
- RQ5: What limits appear when the workspace working set exceeds the fixed `SourceFile` cache capacity?

RQ5 is treated as an observed limitation and hypothesis source, not as a fully proven causal claim.

## Key Findings

- Cogic repository active-file edit: OFF p50 1088.25 ms, SourceFile-only p50 366.03 ms, p50 change 722.22 ms (66.4%).
- Cogic repository active-file edit with the full cache mode: p50 378.67 ms, p50 change 709.57 ms (65.2%). In this scenario, active code changes every iteration, so the full-result cache did not hit.
- Cogic repeated identical analysis: Full-result p50 6.07 ms, p50 change 1183.19 ms (99.5%). This is a best-case cache-hit condition and should not be used as a general editing-performance claim.
- Correctness validation: all cache ON/OFF normalized graph comparisons matched.
- Synthetic 100/500-file workspaces benefited from the `SourceFile` cache in active-edit analysis. Synthetic 1000/2000-file workspaces had zero measured `SourceFile` hits and were slower with cache enabled.

A conservative portfolio or thesis statement from this run is:

> In a Cogic-repository active-file edit benchmark, median analyzer execution time changed from about 1.09 s to 0.38 s when unchanged dependency `SourceFile` objects were reused. The benchmark changed the active buffer every iteration, so this result did not rely on full-result cache hits.

## Directory Structure

- [methodology.md](methodology.md): benchmark environment, cache modes, workloads, timing method, and correctness validation method.
- [results.md](results.md): measured p50, p95, mean, min, max, standard deviation, cache hit counts, and correctness tables.
- [limitations.md](limitations.md): threats to internal, construct, and external validity.
- [future-work.md](future-work.md): experiments needed for a graduation thesis or stronger publication-style evaluation.
- [raw/analysis-cache-results.json](raw/analysis-cache-results.json): raw structured benchmark output.
- [raw/analysis-cache-results.csv](raw/analysis-cache-results.csv): flat table for spreadsheet/chart generation.

## Reproduction

```powershell
npm install
npm run benchmark:cache
```

The benchmark script compiles the extension, generates deterministic synthetic TypeScript workspaces under `.benchmark-workspaces/`, clones the external Zod repository under `.benchmark-external/` when network access is available, and writes raw/results documentation into this directory.

Temporary generated workspaces and external clones are intentionally excluded from Git. Remove them with:

```powershell
Remove-Item -LiteralPath .benchmark-workspaces, .benchmark-external -Recurse -Force
```

