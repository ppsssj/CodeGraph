# Future Thesis Experiments

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
