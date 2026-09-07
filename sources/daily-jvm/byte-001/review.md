# Byte 001 review notes

Source: ../byte-001.md, preserved verbatim. Draft: src/content/lessons/jvm/runtime.md.
Replaces the runtime sample at its existing URL. Published builds omit that URL until draft is explicitly cleared.

Technical refinements: distinguish the abstract JVM contract from HotSpot; avoid a guaranteed interpreter-to-JIT threshold; clarify instance method slot 1; explain that compilation may inline calls/eliminate allocations; clarify heap limits versus process memory; replace the original misleading code-cache → GC → safepoint chain with coordination prose.

Validated on Homebrew OpenJDK 25.0.2, macOS. javac succeeded; javap showed iload_1/iconst_2/imul/ireturn; the bounded 64 MB heap run printed 999999000000. compilation.txt is the actual diagnostic run, showing calculate at levels 3 and 4. This is not a benchmark and no speedup is claimed.

JVM specification, Oracle JDK launcher/javap/HotSpot docs, and an OpenJDK engineer's scalability presentation support the lesson. openjdk.org JEP pages returned 403 through the research tool, so the handshakes citation uses the accessible primary presentation instead.

## Revision after reader feedback — 2026-09-07

Rebuilt the lesson as an introduction: direct JVM definition, source/compiler/runtime handoff, four component responsibilities, then the original calculate method as a connecting example. Removed diagnostic commands, bytecode slot analysis and tier details from the reading path; the previous executed example and log remain as evidence, not required course work. No new execution output is claimed.

Voice target: conversational guidance with terms explained before use; a 1,000-foot component overview before internals. This version awaits user review and is not an approved writing-profile exemplar. Replaced both diagrams with original colored, icon-led SVG illustrations, larger labels and mobile-friendly vertical compositions. A native disclosure question lets readers check their memory-model understanding. Sources are available in a disclosure to preserve reading flow. Original Byte #1 remains unchanged.

Revision verification: Astro check and production build pass; 11 local course routes and anchors checked; draft absent from production navigation/output; original byte unchanged. Desktop and 390px mobile inspected, both SVGs load without page overflow, and the answer disclosure responds to Space with a visible keyboard focus indicator.
