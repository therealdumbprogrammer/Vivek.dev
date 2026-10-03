# Byte 22 review notes

- Placement: Lesson 22, order 220, first lesson in Garbage Collection; local draft after Lesson 21.
- The originating conversation's full source byte and draft were truncated by the conversation reader. The user supplied the reviewed technical decisions in the current request; these drive the integrated lesson.
- Integration rather than repetition: connect prior roots, safepoints/OopMaps, strategies, generations, and barriers in one collection path.
- Distinguish tracing/liveness from space recovery. Mark-sweep leaves holes; compaction and evacuation move survivors and require a valid reference-update protocol.
- The `cost ≈ live data copied` line is explicitly only an intuition. Root processing, remembered sets, reference updates, coordination, bookkeeping, and headroom affect real work.
- JDK 25 G1 is regional, generational, and evacuating. Its default status is qualified to server-class machines, per Oracle's JDK 25 ergonomics guide.
- Diagrams are conceptual; no GC workload or JVM command was executed for this lesson.
- Next: Generational GC mechanics, covering Eden/survivor regions, promotion, remembered sets, and write barriers.
