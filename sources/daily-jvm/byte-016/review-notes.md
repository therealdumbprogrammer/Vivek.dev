# Byte 16 technical and editorial review

- Stable source ID: `byte-016`; lesson slug: `code-cache`; module: `Execution and JIT`; order: `160`.
- The originating reviewed draft was used as the structural basis. The integrated lesson remains `draft: true` under the course's local-review contract, even though the chat draft frontmatter said `draft: false`.
- Preserved Code Cache as native executable memory outside `-Xmx`, three segmented Code Heaps, `nmethod` as code plus runtime metadata, lifecycle and delayed reclamation, pressure diagnostics, JFR correlation, evidence-led tuning, and the safepoint bridge.
- Corrected the oversimplified “invalidated / superseded → unusable → reclaimed” sequence. JDK 25 `nmethod.hpp` defines `not_entrant` as still allowing existing activations, so invalidation does not mean immediate storage reuse.
- Avoided treating the segmented layout as a JVM requirement or the Code Heaps as a strict C1/C2 split. Non-profiled C1 output is possible; the categories describe installed code properties.
- Added diagnostic separation between total occupancy, per-heap usable capacity, reclamation, compiler enabled/stopped/restarted state, compilation success, and compiler queues.
- Primary sources: Oracle JDK 25 `java` launcher documentation; OpenJDK JDK 25 `nmethod.hpp`; OpenJDK JDK 25 JFR `metadata.xml`.
- Local validation used Homebrew OpenJDK HotSpot 25.0.2. `java -XX:+PrintCodeCache -version` reported three heaps, aggregate capacity, `full_count`, and compilation enabled/stopped/restarted counters. The trimmed output is archived separately.
- No throughput or exhaustion experiment was run; the lesson labels the diagnostic output as a short-lived startup observation rather than production evidence.
