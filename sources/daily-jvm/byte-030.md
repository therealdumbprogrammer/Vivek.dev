# Daily JVM Byte #30 — Reading GC logs: reconstructing what the collector is doing

Source: user-supplied Daily JVM Byte #30 in the referenced conversation, followed by a reviewed Lesson 30 draft and explicit implementation requirements. The cached byte preview was truncated; the full original wording is not reconstructed here.

## Available original opening

With JDK 25, start with Unified Logging:

```text
-Xlog:gc*
```

For normal production observation, a common setup is:

```text
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

`-Xlog:gc` gives the high-level events; `-Xlog:gc*` includes detailed GC-tagged information such as heap-region changes and phase timings.

The byte introduces a G1 summary line such as `GC(36) Pause Young (...) 391M->114M(508M) 13.075ms` and distinguishes heap before/after plus current capacity from young-before/young-after plus Xmx. It then begins a multi-event sequence to reason about allocation pressure.

## Reviewed scope retained in Lesson 30

The reviewed draft and user's instructions require GC ID grouping, event type and cause, post-young-GC occupancy caveat, G1 region movement, phase breakdown, concurrent versus stop-the-world timing, healthy and failing cycles, Full GC interpretation, CPU totals, pause frequency, safepoint logging, cross-collector method, reasoning checks, and a bridge to native memory architecture.
