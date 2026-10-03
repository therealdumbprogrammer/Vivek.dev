## Daily JVM Byte #28 — Serial GC and Parallel GC: simplicity vs throughput

Source: originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`. The available source preview contains a bounded opening; the reviewed lesson requirements in the current task supply the complete conversion scope. This archive preserves the visible opening and summarizes the reviewed scope without presenting missing source text as a verbatim byte.

> We just studied G1 and ZGC, where significant GC work is concurrent with the application. That can make older collectors look obsolete. They are not.
>
> JDK 25 still supports four collectors: Serial, Parallel, G1, and ZGC. Serial is the only one that does not parallelize GC work.
>
> Today the question is: what if we accept stop-the-world collection and simply make GC finish as efficiently as possible?
>
> Serial GC uses one GC thread. Removing concurrency and parallelism also removes their overhead. “Serial” describes how GC work is executed, not whether generations exist.

Reviewed scope: Serial and Parallel generational mechanics; parallel versus concurrent work; throughput and tail latency; batch, CLI, and service examples; worker-count/container CPU effects; `MaxGCPauseMillis`, `GCTimeRatio`, adaptive generation sizing, and footprint; all four JDK 25 collector choices; bridge to GC ergonomics and heap sizing. Integrated as `src/content/lessons/jvm/serial-parallel-gc.md`.
