# Bytes 39 and 40 — technical review

- `GC.class_histogram` and `GC.heap_dump` are high-impact JDK 25 `jcmd` operations. A dump normally requests Full GC unless `-all` is specified. A histogram counts shallow bytes; retained-size and root paths require a reference graph.
- `Thread.print` is a platform-thread snapshot. `Thread.dump_to_file -format=json` supports a virtual-thread-aware file dump on JDK 25. RUNNABLE state does not establish CPU use; JFR event samples are not a complete execution trace.
- NMT includes Java Heap reservation and commitment, has to be enabled for useful baselines, and does not cover arbitrary third-party native allocation or equal OS RSS.
- The Lesson 40 diagrams show conceptual relationships. They do not assert fixed headers, exact pointer ownership, eager allocation of profiling metadata, or a one-to-one mapping from virtual threads to JavaThread/OS threads.
- Primary references are in the lessons' collapsed source disclosures. Incidents and values are illustrative; no live JVM diagnostic operation was run.
