# Limitations and Threats to Validity

## Internal Validity

- OS filesystem/page cache was not reset.
- CPU scheduling and background load were not fully controlled.
- Benchmark conditions were not isolated into fresh processes.
- Cache mode execution order was fixed inside each target/scenario group.
- The full-result cache measurement uses a panel-equivalent benchmark harness rather than directly calling the private VS Code `CodeGraphPanel` method, because the production method depends on webview and workspace state.

## Construct Validity

- UI rendering time was not measured.
- VS Code `findFiles` workspace discovery cost was excluded.
- The 350 ms document-change debounce was excluded.
- The measured values are analysis execution time, not full end-to-end perceived UX latency.

## External Validity

- The only external real-world repository in this run was Zod.
- The Cogic repository itself is small compared with large production TypeScript applications.
- Synthetic workspaces preserve controlled dependency structure, but they do not fully represent industrial codebases.
- Results may differ for React, NestJS, Express/Node, and large TypeScript monorepos.
- The Zod active file produced a small graph, so Zod should be treated as one additional data point rather than broad real-world proof.

## Cache-capacity Interpretation

The implementation confirms a maximum analyzer disk `SourceFile` cache size of 800 entries. The benchmark measured zero `SourceFile` hits and slower cache-enabled active-edit/repeated timings for the 1000- and 2000-file synthetic workspaces. This supports a cautious interpretation: when the working set exceeds the cache capacity, the current LRU/access pattern may fail to reuse parsed files effectively.

This run does not prove cache thrashing as the sole cause. A stronger claim requires additional instrumentation for cache occupancy, eviction count, and per-file access sequence.

## Scope of Supported Claims

[Measured]

- p50, p95, mean, min, max, standard deviation, and cache hit counts in [results.md](results.md) and the raw files.
- Cache ON/OFF normalized correctness comparisons for the benchmarked targets.

[Verified from implementation]

- `cogic.analysisCache.enabled` feeds both panel full-result caching and analyzer `SourceFile` caching.
- Analyzer disk `SourceFile` cache capacity is 800 entries.
- Panel full-result cache capacity is 40 entries.
- Workspace file list caching is a separate 10 second panel-layer cache.

[Interpretation]

- Active-file edit is the most defensible user-facing scenario in this benchmark because it changes the active code hash every iteration.
- Repeated identical full-result cache timing is a best-case upper bound, not normal editing performance.
- The 1000/2000-file synthetic results suggest cache capacity/access-pattern limits.

[Future validation]

- Prove or reject LRU thrashing by measuring occupancy, evictions, and access sequence.
- Repeat the benchmark across more real-world TypeScript repositories and framework styles.
- Add end-to-end VS Code latency measurement including debounce, serialization, and webview rendering.

