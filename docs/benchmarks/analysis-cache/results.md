# Results

The raw JSON and CSV files are the source of truth for these tables.

- [raw/analysis-cache-results.json](raw/analysis-cache-results.json)
- [raw/analysis-cache-results.csv](raw/analysis-cache-results.csv)

## Cogic Active-file Edit Result

| Cache | p50 | p95 | mean | p50 vs OFF | SourceFile hits | Result hits |
|---|---:|---:|---:|---:|---:|---:|
| OFF | 1088.25 ms | 1284.78 ms | 1108.59 ms | 0.00 ms (0.0%) | 0 | 0 |
| SourceFile only | 366.03 ms | 428.51 ms | 372.49 ms | 722.22 ms (66.4%) | 5160 | 0 |
| Full result | 378.67 ms | 483.09 ms | 393.35 ms | 709.57 ms (65.2%) | 5160 | 0 |

In the Cogic repository active-file edit scenario, the SourceFile-only condition reduced median analysis execution time from 1088.25 ms to 366.03 ms, a 66.4% reduction. The full-result cache mode measured 378.67 ms p50, a 65.2% reduction, but it had zero result-cache hits because the active buffer changed every iteration.

## Cold Analysis

Clears analyzer and result caches before every iteration, so ON measures cache creation overhead rather than hits.

| Target | Cache | p50 | p95 | mean | min | max | stddev | p50 vs OFF | SourceFile hits | Result hits |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cogic repository | OFF | 1146.57 ms | 1340.68 ms | 1168.54 ms | 1009.62 ms | 1365.72 ms | 106.50 ms | 0.00 ms (0.0%) | 0 | 0 |
| Cogic repository | SourceFile only | 1172.84 ms | 1322.15 ms | 1181.67 ms | 1019.66 ms | 1435.87 ms | 97.31 ms | -26.27 ms (-2.3%) | 0 | 0 |
| Cogic repository | Full result | 1218.92 ms | 1343.65 ms | 1208.36 ms | 1049.77 ms | 1347.67 ms | 92.35 ms | -72.36 ms (-6.3%) | 0 | 0 |
| Synthetic TypeScript workspace (100 files) | OFF | 974.80 ms | 1070.29 ms | 986.70 ms | 943.68 ms | 1138.73 ms | 39.67 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (100 files) | SourceFile only | 1043.23 ms | 1160.45 ms | 1061.55 ms | 975.57 ms | 1291.21 ms | 65.98 ms | -68.43 ms (-7.0%) | 0 | 0 |
| Synthetic TypeScript workspace (100 files) | Full result | 1032.99 ms | 1174.42 ms | 1052.64 ms | 959.74 ms | 1197.97 ms | 55.32 ms | -58.19 ms (-6.0%) | 0 | 0 |
| Synthetic TypeScript workspace (500 files) | OFF | 1504.50 ms | 1839.41 ms | 1555.69 ms | 1354.86 ms | 1936.68 ms | 147.90 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (500 files) | SourceFile only | 1584.67 ms | 1806.29 ms | 1598.92 ms | 1395.63 ms | 1849.94 ms | 111.14 ms | -80.17 ms (-5.3%) | 0 | 0 |
| Synthetic TypeScript workspace (500 files) | Full result | 1451.49 ms | 1633.81 ms | 1475.35 ms | 1385.76 ms | 1718.14 ms | 70.43 ms | 53.00 ms (3.5%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | OFF | 1991.10 ms | 2151.77 ms | 2001.74 ms | 1914.56 ms | 2171.35 ms | 68.79 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | SourceFile only | 2131.43 ms | 2322.37 ms | 2149.66 ms | 1987.20 ms | 2324.65 ms | 76.91 ms | -140.33 ms (-7.0%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | Full result | 2122.54 ms | 2687.03 ms | 2255.25 ms | 2009.25 ms | 3262.14 ms | 272.48 ms | -131.45 ms (-6.6%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | OFF | 3064.67 ms | 3287.84 ms | 3084.21 ms | 2965.96 ms | 3288.36 ms | 88.63 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | SourceFile only | 3368.13 ms | 3628.90 ms | 3392.77 ms | 3203.12 ms | 3777.57 ms | 123.26 ms | -303.46 ms (-9.9%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | Full result | 3433.72 ms | 3543.47 ms | 3426.14 ms | 3288.90 ms | 3557.28 ms | 83.01 ms | -369.05 ms (-12.0%) | 0 | 0 |
| External real-world repository (zod) | OFF | 1708.42 ms | 1817.96 ms | 1717.04 ms | 1656.58 ms | 1983.36 ms | 60.95 ms | 0.00 ms (0.0%) | 0 | 0 |
| External real-world repository (zod) | SourceFile only | 1788.21 ms | 1837.79 ms | 1781.47 ms | 1697.67 ms | 1842.26 ms | 39.44 ms | -79.79 ms (-4.7%) | 0 | 0 |
| External real-world repository (zod) | Full result | 1735.99 ms | 1817.80 ms | 1747.80 ms | 1666.16 ms | 1844.16 ms | 46.85 ms | -27.57 ms (-1.6%) | 0 | 0 |

## Repeated Identical Analysis

Keeps identical active code, graph depth, trace settings, and workspace file state across iterations.

| Target | Cache | p50 | p95 | mean | min | max | stddev | p50 vs OFF | SourceFile hits | Result hits |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cogic repository | OFF | 1189.26 ms | 1400.75 ms | 1198.07 ms | 985.51 ms | 1700.92 ms | 145.54 ms | 0.00 ms (0.0%) | 0 | 0 |
| Cogic repository | SourceFile only | 385.44 ms | 521.87 ms | 399.26 ms | 355.26 ms | 555.64 ms | 48.10 ms | 803.82 ms (67.6%) | 5160 | 0 |
| Cogic repository | Full result | 6.07 ms | 7.96 ms | 6.39 ms | 5.51 ms | 8.06 ms | 0.78 ms | 1183.19 ms (99.5%) | 0 | 30 |
| Synthetic TypeScript workspace (100 files) | OFF | 1178.34 ms | 1947.38 ms | 1288.61 ms | 1055.97 ms | 2239.76 ms | 255.44 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (100 files) | SourceFile only | 245.57 ms | 286.21 ms | 248.34 ms | 225.07 ms | 289.00 ms | 17.96 ms | 932.78 ms (79.2%) | 7770 | 0 |
| Synthetic TypeScript workspace (100 files) | Full result | 0.50 ms | 1.26 ms | 0.67 ms | 0.49 ms | 4.08 ms | 0.65 ms | 1177.84 ms (100.0%) | 0 | 30 |
| Synthetic TypeScript workspace (500 files) | OFF | 1432.56 ms | 1600.12 ms | 1447.80 ms | 1368.29 ms | 1654.41 ms | 69.71 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (500 files) | SourceFile only | 341.19 ms | 403.95 ms | 354.12 ms | 328.11 ms | 414.16 ms | 22.72 ms | 1091.37 ms (76.2%) | 19770 | 0 |
| Synthetic TypeScript workspace (500 files) | Full result | 2.72 ms | 4.02 ms | 3.03 ms | 2.54 ms | 4.57 ms | 0.57 ms | 1429.83 ms (99.8%) | 0 | 30 |
| Synthetic TypeScript workspace (1000 files) | OFF | 1958.00 ms | 2075.81 ms | 1962.41 ms | 1840.39 ms | 2076.05 ms | 69.40 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | SourceFile only | 2168.99 ms | 2331.22 ms | 2203.69 ms | 2073.04 ms | 2344.82 ms | 68.54 ms | -210.99 ms (-10.8%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | Full result | 5.13 ms | 6.74 ms | 5.48 ms | 4.78 ms | 7.20 ms | 0.65 ms | 1952.87 ms (99.7%) | 0 | 30 |
| Synthetic TypeScript workspace (2000 files) | OFF | 3133.75 ms | 3227.50 ms | 3147.11 ms | 3044.47 ms | 3483.94 ms | 78.81 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | SourceFile only | 3516.65 ms | 3709.96 ms | 3530.25 ms | 3298.90 ms | 3763.38 ms | 105.06 ms | -382.91 ms (-12.2%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | Full result | 11.74 ms | 25.05 ms | 13.46 ms | 9.39 ms | 41.93 ms | 6.18 ms | 3122.00 ms (99.6%) | 0 | 30 |
| External real-world repository (zod) | OFF | 1683.90 ms | 1788.26 ms | 1689.40 ms | 1602.52 ms | 1793.35 ms | 48.84 ms | 0.00 ms (0.0%) | 0 | 0 |
| External real-world repository (zod) | SourceFile only | 287.02 ms | 305.17 ms | 288.36 ms | 279.15 ms | 312.90 ms | 7.07 ms | 1396.88 ms (83.0%) | 16020 | 0 |
| External real-world repository (zod) | Full result | 1.77 ms | 2.61 ms | 1.84 ms | 1.55 ms | 2.80 ms | 0.35 ms | 1682.14 ms (99.9%) | 0 | 30 |

## Active-file Edit Analysis

Changes active in-memory code every iteration so full-result cache keys do not repeat; unchanged dependency files may hit the SourceFile cache.

| Target | Cache | p50 | p95 | mean | min | max | stddev | p50 vs OFF | SourceFile hits | Result hits |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cogic repository | OFF | 1088.25 ms | 1284.78 ms | 1108.59 ms | 967.20 ms | 1309.98 ms | 96.02 ms | 0.00 ms (0.0%) | 0 | 0 |
| Cogic repository | SourceFile only | 366.03 ms | 428.51 ms | 372.49 ms | 351.84 ms | 433.53 ms | 19.44 ms | 722.22 ms (66.4%) | 5160 | 0 |
| Cogic repository | Full result | 378.67 ms | 483.09 ms | 393.35 ms | 371.51 ms | 491.33 ms | 30.58 ms | 709.57 ms (65.2%) | 5160 | 0 |
| Synthetic TypeScript workspace (100 files) | OFF | 1008.35 ms | 1066.43 ms | 1010.55 ms | 966.02 ms | 1090.61 ms | 27.45 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (100 files) | SourceFile only | 235.27 ms | 256.12 ms | 238.14 ms | 225.85 ms | 275.86 ms | 10.35 ms | 773.07 ms (76.7%) | 7770 | 0 |
| Synthetic TypeScript workspace (100 files) | Full result | 230.50 ms | 248.50 ms | 233.38 ms | 224.69 ms | 256.27 ms | 7.57 ms | 777.85 ms (77.1%) | 7770 | 0 |
| Synthetic TypeScript workspace (500 files) | OFF | 1437.96 ms | 1568.42 ms | 1462.55 ms | 1347.40 ms | 1755.91 ms | 82.37 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (500 files) | SourceFile only | 334.64 ms | 370.78 ms | 341.61 ms | 328.54 ms | 389.84 ms | 14.18 ms | 1103.32 ms (76.7%) | 19770 | 0 |
| Synthetic TypeScript workspace (500 files) | Full result | 343.54 ms | 412.44 ms | 355.28 ms | 331.17 ms | 443.25 ms | 25.49 ms | 1094.42 ms (76.1%) | 19770 | 0 |
| Synthetic TypeScript workspace (1000 files) | OFF | 2004.27 ms | 2205.71 ms | 2014.54 ms | 1882.80 ms | 2289.39 ms | 85.75 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | SourceFile only | 2187.75 ms | 2526.03 ms | 2225.44 ms | 2055.19 ms | 2679.51 ms | 133.13 ms | -183.48 ms (-9.2%) | 0 | 0 |
| Synthetic TypeScript workspace (1000 files) | Full result | 2145.29 ms | 2322.24 ms | 2165.34 ms | 2059.06 ms | 2348.76 ms | 80.00 ms | -141.02 ms (-7.0%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | OFF | 3093.25 ms | 3297.93 ms | 3120.81 ms | 2943.12 ms | 3312.09 ms | 91.80 ms | 0.00 ms (0.0%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | SourceFile only | 3537.72 ms | 3700.85 ms | 3551.38 ms | 3366.18 ms | 3877.75 ms | 101.40 ms | -444.48 ms (-14.4%) | 0 | 0 |
| Synthetic TypeScript workspace (2000 files) | Full result | 3533.44 ms | 3771.13 ms | 3535.88 ms | 3350.67 ms | 3840.98 ms | 111.25 ms | -440.20 ms (-14.2%) | 0 | 0 |
| External real-world repository (zod) | OFF | 1698.58 ms | 1766.65 ms | 1704.89 ms | 1627.79 ms | 1781.20 ms | 37.58 ms | 0.00 ms (0.0%) | 0 | 0 |
| External real-world repository (zod) | SourceFile only | 286.17 ms | 310.80 ms | 288.94 ms | 281.38 ms | 319.87 ms | 8.45 ms | 1412.41 ms (83.2%) | 16020 | 0 |
| External real-world repository (zod) | Full result | 288.53 ms | 314.53 ms | 292.80 ms | 284.30 ms | 328.77 ms | 9.99 ms | 1410.05 ms (83.0%) | 16020 | 0 |

## Synthetic Scaling

| Files | Scenario | OFF p50 | SourceFile p50 | Full result p50 | SourceFile p50 change | Full result p50 change |
|---:|---|---:|---:|---:|---:|---:|
| 100 | Cold Analysis | 974.80 ms | 1043.23 ms | 1032.99 ms | -68.43 ms (-7.0%) | -58.19 ms (-6.0%) |
| 100 | Repeated Identical Analysis | 1178.34 ms | 245.57 ms | 0.50 ms | 932.78 ms (79.2%) | 1177.84 ms (100.0%) |
| 100 | Active-file Edit Analysis | 1008.35 ms | 235.27 ms | 230.50 ms | 773.07 ms (76.7%) | 777.85 ms (77.1%) |
| 500 | Cold Analysis | 1504.50 ms | 1584.67 ms | 1451.49 ms | -80.17 ms (-5.3%) | 53.00 ms (3.5%) |
| 500 | Repeated Identical Analysis | 1432.56 ms | 341.19 ms | 2.72 ms | 1091.37 ms (76.2%) | 1429.83 ms (99.8%) |
| 500 | Active-file Edit Analysis | 1437.96 ms | 334.64 ms | 343.54 ms | 1103.32 ms (76.7%) | 1094.42 ms (76.1%) |
| 1000 | Cold Analysis | 1991.10 ms | 2131.43 ms | 2122.54 ms | -140.33 ms (-7.0%) | -131.45 ms (-6.6%) |
| 1000 | Repeated Identical Analysis | 1958.00 ms | 2168.99 ms | 5.13 ms | -210.99 ms (-10.8%) | 1952.87 ms (99.7%) |
| 1000 | Active-file Edit Analysis | 2004.27 ms | 2187.75 ms | 2145.29 ms | -183.48 ms (-9.2%) | -141.02 ms (-7.0%) |
| 2000 | Cold Analysis | 3064.67 ms | 3368.13 ms | 3433.72 ms | -303.46 ms (-9.9%) | -369.05 ms (-12.0%) |
| 2000 | Repeated Identical Analysis | 3133.75 ms | 3516.65 ms | 11.74 ms | -382.91 ms (-12.2%) | 3122.00 ms (99.6%) |
| 2000 | Active-file Edit Analysis | 3093.25 ms | 3537.72 ms | 3533.44 ms | -444.48 ms (-14.4%) | -440.20 ms (-14.2%) |

The 100- and 500-file synthetic active-edit workloads showed large `SourceFile` cache benefits. The 1000- and 2000-file synthetic workloads showed zero measured `SourceFile` cache hits and slower cache-enabled timings. The code confirms a maximum disk `SourceFile` cache size of 800 entries; the benchmark results suggest that a working set larger than the cache capacity and the observed access/eviction pattern may cause ineffective reuse. Confirming cache thrashing requires additional eviction, occupancy, and per-file access-sequence instrumentation.

## External Real-world Repository

| Scenario | Cache | p50 | p95 | mean | p50 vs OFF | SourceFile hits | Result hits |
|---|---|---:|---:|---:|---:|---:|---:|
| Cold Analysis | OFF | 1708.42 ms | 1817.96 ms | 1717.04 ms | 0.00 ms (0.0%) | 0 | 0 |
| Cold Analysis | SourceFile only | 1788.21 ms | 1837.79 ms | 1781.47 ms | -79.79 ms (-4.7%) | 0 | 0 |
| Cold Analysis | Full result | 1735.99 ms | 1817.80 ms | 1747.80 ms | -27.57 ms (-1.6%) | 0 | 0 |
| Repeated Identical Analysis | OFF | 1683.90 ms | 1788.26 ms | 1689.40 ms | 0.00 ms (0.0%) | 0 | 0 |
| Repeated Identical Analysis | SourceFile only | 287.02 ms | 305.17 ms | 288.36 ms | 1396.88 ms (83.0%) | 16020 | 0 |
| Repeated Identical Analysis | Full result | 1.77 ms | 2.61 ms | 1.84 ms | 1682.14 ms (99.9%) | 0 | 30 |
| Active-file Edit Analysis | OFF | 1698.58 ms | 1766.65 ms | 1704.89 ms | 0.00 ms (0.0%) | 0 | 0 |
| Active-file Edit Analysis | SourceFile only | 286.17 ms | 310.80 ms | 288.94 ms | 1412.41 ms (83.2%) | 16020 | 0 |
| Active-file Edit Analysis | Full result | 288.53 ms | 314.53 ms | 292.80 ms | 1410.05 ms (83.0%) | 16020 | 0 |

Zod also showed large repeated and active-edit improvements when the `SourceFile` cache hit. However, the selected active file is an index/re-export style file and the resulting graph is small, so this result should not be generalized to all real-world TypeScript projects.

## Correctness Validation

| Target | Cache | Same normalized result | OFF counts | Cache counts |
|---|---|---:|---|---|
| Cogic repository | SourceFile only | yes | nodes 132, edges 576, imports 9, exports 2, calls 60, diagnostics 0 | nodes 132, edges 576, imports 9, exports 2, calls 60, diagnostics 0 |
| Cogic repository | Full result | yes | nodes 132, edges 576, imports 9, exports 2, calls 60, diagnostics 0 | nodes 132, edges 576, imports 9, exports 2, calls 60, diagnostics 0 |
| Synthetic TypeScript workspace (100 files) | SourceFile only | yes | nodes 13, edges 19, imports 9, exports 3, calls 9, diagnostics 0 | nodes 13, edges 19, imports 9, exports 3, calls 9, diagnostics 0 |
| Synthetic TypeScript workspace (100 files) | Full result | yes | nodes 13, edges 19, imports 9, exports 3, calls 9, diagnostics 0 | nodes 13, edges 19, imports 9, exports 3, calls 9, diagnostics 0 |
| Synthetic TypeScript workspace (500 files) | SourceFile only | yes | nodes 49, edges 91, imports 45, exports 3, calls 45, diagnostics 0 | nodes 49, edges 91, imports 45, exports 3, calls 45, diagnostics 0 |
| Synthetic TypeScript workspace (500 files) | Full result | yes | nodes 49, edges 91, imports 45, exports 3, calls 45, diagnostics 0 | nodes 49, edges 91, imports 45, exports 3, calls 45, diagnostics 0 |
| Synthetic TypeScript workspace (1000 files) | SourceFile only | yes | nodes 93, edges 179, imports 89, exports 3, calls 60, diagnostics 0 | nodes 93, edges 179, imports 89, exports 3, calls 60, diagnostics 0 |
| Synthetic TypeScript workspace (1000 files) | Full result | yes | nodes 93, edges 179, imports 89, exports 3, calls 60, diagnostics 0 | nodes 93, edges 179, imports 89, exports 3, calls 60, diagnostics 0 |
| Synthetic TypeScript workspace (2000 files) | SourceFile only | yes | nodes 184, edges 361, imports 180, exports 3, calls 60, diagnostics 0 | nodes 184, edges 361, imports 180, exports 3, calls 60, diagnostics 0 |
| Synthetic TypeScript workspace (2000 files) | Full result | yes | nodes 184, edges 361, imports 180, exports 3, calls 60, diagnostics 0 | nodes 184, edges 361, imports 180, exports 3, calls 60, diagnostics 0 |
| External real-world repository (zod) | SourceFile only | yes | nodes 2, edges 0, imports 1, exports 4, calls 0, diagnostics 0 | nodes 2, edges 0, imports 1, exports 4, calls 0, diagnostics 0 |
| External real-world repository (zod) | Full result | yes | nodes 2, edges 0, imports 1, exports 4, calls 0, diagnostics 0 | nodes 2, edges 0, imports 1, exports 4, calls 0, diagnostics 0 |

All comparisons in this run matched. This verifies that the measured cache-enabled paths preserved the normalized analysis output for the benchmark inputs.

## Best-case Cache Hit Warning

The repeated identical full-result rows are best-case cache-hit measurements. They reuse a completed analysis result for the same code hash and the same analysis settings. They should not be used as a README headline, paper abstract number, or general editing-performance claim.

