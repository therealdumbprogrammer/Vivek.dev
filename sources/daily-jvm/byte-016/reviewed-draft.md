# Reviewed draft — Lesson 16: The Code Cache

Recovered from the originating “Save Backend Resource” conversation (`6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`). This archive keeps the reviewed structure and technical decisions that drove the integrated lesson; the lesson file contains the final beginner-first prose and JDK 25 source updates.

## Review decisions

- Treat an `nmethod` as HotSpot's compiled-method artifact, not merely machine instructions. GC, stack walking, safepoints, exceptions, and deoptimization depend on its metadata.
- Keep segmented Code Cache as a HotSpot implementation detail rather than a JVM requirement.
- Show the compiled-code lifecycle without implying that invalidation frees storage immediately.
- Separate occupancy, fragmentation or usable space, compilation state, and compiler activity as diagnostic signals.
- End with compiled-code metadata as the direct bridge to safepoints.

## Draft metadata

```yaml
title: The Code Cache — where JIT-compiled machine code lives
summary: See where HotSpot stores compiled native code, what an nmethod contains, how compiled code is managed over time, and why Code Cache pressure can affect application performance.
course: jvm
lessonSlug: code-cache
module: Execution and JIT
order: 160
sourceByte: byte-016
prerequisites:
  - speculative-optimization-deoptimization
jdk: HotSpot · Code Cache and compiled methods
```

## Reviewed teaching sequence

1. Open with the physical question left by C1, C2, invalidation, and recompilation: where does generated machine code live?
2. Establish the complete path: bytecode → interpreter and profiles → C1/C2 → `nmethod` → Code Cache → CPU.
3. Place the Code Cache in native process memory outside the Java heap and `-Xmx`.
4. Explain the three segmented HotSpot Code Heaps: profiled nmethods, non-profiled nmethods, and non-method code.
5. Expand `nmethod` into machine instructions plus relocation, stack/debug, safepoint, deoptimization, exception, and runtime metadata.
6. Connect that metadata back to inlined-frame reconstruction from Lesson 15.
7. Trace creation, installation, execution, supersession or invalidation, non-entrant state, and eventual reclamation.
8. Explain segmentation through lifecycle grouping, fragmentation management, and instruction-cache/iTLB locality.
9. Show how a constrained heap can restrict JIT compilation even when Java heap and GC signals look healthy.
10. Diagnose with per-heap usable space, reclamation, compilation state, compiler queues, `PrintCodeCache`, sizing flags, and correlated JFR evidence.
11. Keep tuning evidence-driven and frame Code Cache pressure as a targeted production hypothesis, not the default explanation.
12. Synthesize the adaptive execution pipeline and lead directly into safepoints.

## Reviewed emphasis

- Inline highlight: the Java heap stores Java objects while the Code Cache stores executable JVM-generated code.
- Inline highlight: compiled code is instructions plus enough metadata for HotSpot to remain in control.
- Inline highlight: invalidation does not imply immediate memory reuse.
- One restrained Production note: tune only after evidence connects per-heap pressure, compiler behavior, and an application effect.

## Planned figures

- `code-cache-overview.svg`
- `code-cache-process-memory.svg`
- `code-cache-segments.svg`
- `nmethod-anatomy.svg`
- `nmethod-lifecycle.svg`
- `code-cache-fragmentation.svg`
- `code-cache-pressure.svg`
- `code-cache-complete.svg`

The originating draft used `draft: false`. Repository policy takes precedence for a new conversion, so the integrated lesson remains `draft: true` until explicit review acceptance.
