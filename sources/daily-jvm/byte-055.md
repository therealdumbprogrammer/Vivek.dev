# Daily JVM Byte #55 — Safepoint Diagnostics: When the JVM Stops the World Without GC

**Baseline:** JDK 25 LTS  
**Focus:** Safepoint synchronization, VM operations, time-to-safepoint, and diagnosing non-GC pauses.

In Byte #54, we examined how HotSpot tracks native memory allocations.

Today, we're returning to JVM execution internals.

We previously learned that safepoints allow HotSpot to perform operations requiring a consistent view of Java threads and their execution state.

But there's an important production implication:

> **Not every stop-the-world pause is caused by garbage collection. And even when GC triggers a pause, the time required to reach the safepoint can contribute additional latency.**

Let's examine how to distinguish these costs.

---

## 1. Why HotSpot needs safepoints beyond GC

Certain VM operations require Java threads to reach a coordinated execution state.

Examples include:

| VM activity | Why coordination is needed |
|---|---|
| Stop-the-world GC | Inspect and potentially update object references |
| Some class redefinition operations | Coordinate changes to runtime metadata and execution |
| Certain deoptimization operations | Safely transition compiled execution state |
| Heap inspection | Obtain a consistent view of heap structures |
| Some diagnostic operations | Safely inspect JVM runtime structures |

A safepoint is therefore a general HotSpot coordination mechanism, not a feature exclusive to garbage collection.

The distinction matters because GC monitoring alone may not explain every application pause.

---

## 2. A safepoint has multiple phases

Consider a VM operation that requires a global safepoint.

Conceptually:

```text
VM requests safepoint
         │
         ▼
Threads reach safe states
         │
         ▼
All relevant threads are safe
         │
         ▼
VM operation executes
         │
         ▼
Threads resume
```

The total duration contains three important components:

```text
┌───────────────────┬──────────────────┬──────────────┐
│ Reaching          │ At safepoint     │ Leaving      │
│ safepoint         │                  │ safepoint    │
└───────────────────┴──────────────────┴──────────────┘
         │                  │                 │
         ▼                  ▼                 ▼
   Synchronization     VM operation       Resume
```

The first component is particularly interesting.

### Time to safepoint (TTSP)

Suppose HotSpot requests a safepoint.

Three application threads reach a safe state quickly, but a fourth continues executing code without reaching an appropriate poll.

```text
Thread A: ───●───────────────────────────────▶
Thread B: ─────●─────────────────────────────▶
Thread C: ────●──────────────────────────────▶
Thread D: ────────────────────●──────────────▶
                             │
                      Safepoint reached
```

The VM must wait for Thread D.

During that interval, threads that have already stopped are waiting, while Thread D may still be executing.

**TTSP is not the same as the duration of the VM operation itself.**

This distinction is implemented directly in JDK 25's `SafepointSynchronize` and `SafepointTracing` code. [GitHub](https://raw.githubusercontent.com/openjdk/jdk/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp)

---

## 3. How Java threads reach safepoints

Recall our earlier lessons on bytecode execution and JIT compilation.

HotSpot uses different mechanisms depending on the thread's execution state.

### Interpreted execution

The interpreter checks for safepoint requests at appropriate execution points.

### JIT-compiled execution

Compiled code contains safepoint polls.

Conceptually:

```text
Compiled method
    │
    ├── Machine instructions
    │
    ├── Safepoint poll
    │
    ├── More instructions
    │
    └── Safepoint poll
```

On supported platforms, polling can involve accessing a specially managed memory location. When a safepoint is requested, the poll causes execution to enter HotSpot's safepoint-handling machinery.

### Native or blocked threads

A thread executing native code is not necessarily required to stop immediately inside that native code.

HotSpot can recognize certain thread states as safepoint-safe and prevent the thread from reentering unsafe Java execution until the operation completes.

Similarly, blocked threads can already be in a safe state.

This avoids requiring every thread to actively execute a safepoint poll.

The JDK 25 implementation documents these cases in `SafepointSynchronize::arm_safepoint()`. [GitHub](https://raw.githubusercontent.com/openjdk/jdk/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp)

---

## 4. Why reaching a safepoint can take longer than expected

Imagine a JIT-compiled method performing a long-running operation.

```java
void process(byte[] source, byte[] destination) {
    System.arraycopy(
        source, 0,
        destination, 0,
        source.length
    );
}
```

HotSpot may intrinsify `System.arraycopy`, replacing the Java-level call with optimized native machine-code sequences.

Depending on the generated code and operation size, execution may spend substantial time in a section without an available safepoint poll.

If a safepoint is requested during that period, the VM may have to wait.

This illustrates an important trade-off:

**Highly optimized machine code must balance execution efficiency with the JVM's need for cooperative runtime coordination.**

HotSpot inserts polls strategically rather than after every machine instruction.

Too many polls increase execution overhead. Too few can increase safepoint synchronization latency.

---

## 5. Reading JDK 25 safepoint logs

Enable safepoint logging:

```bash
java \
  -Xlog:safepoint=info \
  -jar application.jar
```

An illustrative JDK 25 log entry:

```text
[12.450s][info][safepoint]
Safepoint "G1CollectForAllocation",
Time since last: 1500000000 ns,
Reaching safepoint: 18000000 ns,
At safepoint: 4000000 ns,
Leaving safepoint: 100000 ns,
Total: 22100000 ns,
Threads: 4 runnable, 25 total
```

The values are illustrative.

Let's interpret them.

| Field | Duration | Meaning |
|---|---:|---|
| Reaching safepoint | 18 ms | Synchronizing Java threads |
| At safepoint | 4 ms | Time spent while the JVM is at the safepoint |
| Leaving safepoint | 0.1 ms | Completing safepoint exit |
| Total | 22.1 ms | Entire safepoint interval |

Notice something important.

The VM operation spent approximately 4 ms at the safepoint, but the total interval was 22.1 ms.

Most of the delay came from reaching the safepoint.

**This is why GC pause duration and total safepoint duration are not interchangeable measurements.**

JDK 25's `SafepointTracing::end()` emits these exact timing categories. [GitHub](https://raw.githubusercontent.com/openjdk/jdk/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp)

---

## 6. Diagnosing non-GC safepoints

Now consider another illustrative entry:

```text
Safepoint "PrintThreads",
Reaching safepoint: 200000 ns,
At safepoint: 8000000 ns,
Leaving safepoint: 100000 ns,
Total: 8300000 ns
```

Here, the operation is associated with thread inspection rather than garbage collection.

The VM spent approximately 8 ms at the safepoint.

A GC dashboard would not necessarily explain this pause.

This is why safepoint logs should be considered alongside GC logs.

### Two useful diagnostic patterns

| Observation | Investigation |
|---|---|
| High `Reaching safepoint` | Why did one or more threads take so long to become safe? |
| High `At safepoint` | Which VM operation was running, and why was it expensive? |

These lead to different investigations.

A slow synchronization phase might involve long-running compiled code or scheduling delays.

A slow VM operation might involve expensive heap inspection, GC processing, or other runtime work.

---

## 7. Hands-on: correlate GC and safepoint activity

Start an application with both logging categories:

```bash
java \
  -Xms1g \
  -Xmx1g \
  -XX:+UseG1GC \
  -Xlog:gc=info,safepoint=info:file=jvm.log:time,uptime,level,tags \
  -jar application.jar
```

Observe the relationship between GC pauses and safepoint intervals.

For additional safepoint statistics:

```text
-Xlog:safepoint+stats=info
```

These statistics include synchronization time, VM operation time, and the number of participating threads.

### Investigating an already-running JVM

You can enable safepoint logging dynamically:

```bash
jcmd <pid> VM.log what=safepoint=info
```

This is useful when investigating unexplained latency without restarting the application.

### JFR correlation

JDK 25 also exposes safepoint-related JFR events, including:

| Event | Purpose |
|---|---|
| `jdk.SafepointBegin` | Safepoint entry information |
| `jdk.SafepointStateSynchronization` | Thread synchronization activity |
| `jdk.SafepointEnd` | Safepoint completion |
| `jdk.ExecuteVMOperation` | VM operation execution |

Event availability in a recording depends on the JFR configuration.

JDK 25 additionally introduced `jdk.SafepointLatency` through **JEP 518 — JFR Cooperative Sampling**.

An important distinction: this event measures latency associated with cooperative sampling requests. It is **not a comprehensive record of every global safepoint's synchronization delay**. Use safepoint logs for that purpose. [Erik Gahlin’s Blog](https://egahlin.github.io/2025/05/31/whats-new-in-jdk-25.html?utm_source=chatgpt.com)

---

## 8. Global safepoints versus thread-local handshakes

Not every operation requiring a thread to reach a safe execution state needs to stop every Java thread.

HotSpot also supports **thread-local handshakes**.

Conceptually:

```text
Global safepoint:

Thread A ── STOP
Thread B ── STOP
Thread C ── STOP
Thread D ── STOP


Thread-local handshake:

Thread A ── RUN
Thread B ── HANDSHAKE
Thread C ── RUN
Thread D ── RUN
```

A handshake can execute an operation in coordination with one or more selected threads without requiring a global safepoint.

This reduces unnecessary interference with unrelated application threads.

However, handshakes still depend on safe execution states and can experience coordination delays.

They are not universally interchangeable with global safepoints.

This is another example of HotSpot evolving toward finer-grained runtime coordination.

---

## 9. Production implications

Suppose an application's p99 latency periodically jumps from 20 ms to 80 ms.

GC logs show:

```text
Maximum GC pause: 5 ms
```

It would be incorrect to conclude that JVM pauses cannot explain the remaining latency.

A more complete investigation correlates:

- Application latency timestamps.
- GC pause events.
- Safepoint synchronization and execution durations.
- VM operation names.
- CPU scheduling and runtime activity.

If a safepoint interval aligns with a latency spike, determine whether the delay occurred while reaching the safepoint or executing the operation.

Avoid changing GC parameters until you know which component is responsible.

---

## Mental model checkpoint

We've now connected several major JVM concepts:

```text
Java application
       │
       ▼
Interpreter / JIT-compiled code
       │
       ├── Safepoint polls
       │
       └── Thread-state transitions
                │
                ▼
         Safepoint coordination
                │
       ┌────────┴────────┐
       ▼                 ▼
  Global safepoint   Thread handshake
       │                 │
       ▼                 ▼
  VM operation       Targeted operation
       │                 │
       └────────┬────────┘
                │
                ▼
        Application latency
```

This connects execution machinery, thread management, garbage collection, diagnostics, and JIT-generated machine code.

### Key takeaway

**A JVM pause has two fundamentally different costs: coordinating threads and performing the requested VM operation.**

GC logs primarily explain collection work. Safepoint logs expose the broader coordination process, including non-GC operations.

When investigating unexplained latency, examine both.

### Next byte — #56: Deoptimization in Production — When JIT Assumptions Become Invalid

We'll revisit speculative optimization and deoptimization, but from a diagnostic perspective.

We'll investigate how class loading, uncommon execution paths, and invalidated compiled-code assumptions can trigger deoptimization, and how to distinguish normal JIT adaptation from a performance problem.

**JDK 25 references:** [HotSpot safepoint implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp?utm_source=chatgpt.com) · [JDK 25 diagnostic tools](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html) · [JFR event reference for JDK 25](https://sap.github.io/jfrevents/25.html?utm_source=chatgpt.com)