## Daily JVM Byte #27 — ZGC in JDK 25: concurrent relocation and load barriers

Source: bounded preview of the originating ChatGPT conversation, `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`, plus the reviewed lesson requirements supplied in the current task. The original byte was truncated in the available conversation preview; this file preserves its visible opening rather than inventing the omitted text.

> We have spent several days building G1's model:
>
> ```text
> G1:
> select regions
>     ↓
> stop application threads
>     ↓
> evacuate live objects
>     ↓
> update references
>     ↓
> resume
> ```
>
> G1 does substantial work concurrently, but **object evacuation itself occurs during stop-the-world pauses**.
>
> ZGC attacks that specific problem differently:
>
> Move objects while application threads continue running.
>
> In JDK 25, ZGC is **generational only**; the old non-generational implementation was removed in JDK 24. Enable it with `-XX:+UseZGC`.

The reviewed scope adds colored references, forwarding, mutator slow-path participation, self-healing, generational store barriers, short coordination pauses, headroom, diagnostics, and a G1/Parallel/Serial course bridge. The integrated lesson is `src/content/lessons/jvm/zgc-jdk-25.md`.
