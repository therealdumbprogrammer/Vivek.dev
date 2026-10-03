# Daily JVM Byte #31 — Native memory: why `-Xmx` is not your process limit

Source: originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`. This is a bounded available excerpt plus the reviewed scope, not a claim to reproduce the complete original byte.

> Yesterday we finished the GC block by learning how to reconstruct memory behavior from GC logs. Now we move one level outward.
>
> A JVM process is much larger than its Java heap: Java Heap, Metaspace, Compressed Class Space, Code Cache, Thread Stacks, GC native structures, Direct / mapped buffers, JNI / native libraries, and JVM internal allocations.
>
> The heap looks healthy, but the JVM process is consuming far more memory—or the container is OOM-killed.

Reviewed scope: process budget, reserved/committed/RSS, native subsystems, NMT coverage and baseline/diff, and diagnostic escalation from heap to HotSpot to OS/native tools. Preserve the crucial NMT limitation concerning third-party and JDK class-library allocations.
