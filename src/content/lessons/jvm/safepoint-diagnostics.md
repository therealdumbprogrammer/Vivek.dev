---
title: Safepoint diagnostics — when the JVM stops the world without GC
summary: Separate time spent reaching a HotSpot safepoint from work done at it, then correlate non-GC VM operations with application latency.
course: jvm
lessonSlug: safepoint-diagnostics
module: HotSpot Internals
order: 550
sourceByte: byte-055
draft: false
prerequisites:
  - native-memory-tracking-internals
jdk: JDK 25 · HotSpot safepoints and JFR
---


In [Lesson 54](/courses/jvm/native-memory-tracking-internals), we traced HotSpot’s native-memory accounting. Here we return to the execution machinery introduced in [Lesson 17](/courses/jvm/safepoints) and investigate an application symptom: a p99 request spike that the GC pause chart cannot explain.


A **global safepoint** is a HotSpot coordination point at which Java threads are in states safe for a VM operation. It is an implementation mechanism, not a Java language rule. The VM first requests cooperation, waits for relevant threads, performs the operation, then releases them.

But there's an important production implication:

> **Not every stop-the-world pause is caused by garbage collection. And even when GC triggers a pause, the time required to reach the safepoint can contribute additional latency.**

Let's examine how to distinguish these costs.


## Why HotSpot needs safepoints beyond GC

Certain VM operations require Java threads to reach a coordinated execution state.

Examples include:

| VM activity | Why coordination is needed |
|---|---|
| Stop-the-world GC | Inspect and potentially update object references |
| Some class redefinition operations | Coordinate changes to runtime metadata and execution |
| Certain deoptimization operations | Safely transition compiled execution state |
| Heap inspection | Obtain a consistent view of heap structures |
| Some diagnostic operations | Safely inspect JVM runtime structures |

Other examples include some runtime cleanup and compiled-code invalidation work. These are examples of operations that *can* require a global safepoint, not promises that every instance does. In particular, a thread dump need not stop all Java threads: HotSpot can use thread-local handshakes for targeted inspection.

<mark>A safepoint is a general HotSpot coordination mechanism; GC is only one possible requester.</mark>

The distinction matters because GC monitoring alone may not explain every application pause.


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable the last arriving thread determines when global synchronization completes."><a href="/images/courses/jvm/safepoint-thread-arrival-timeline.svg" aria-label="Open the last arriving thread determines when global synchronization completes."><img src="/images/courses/jvm/safepoint-thread-arrival-timeline.svg" alt="Four thread lifelines join at different times; three wait while the last continues, followed by a short VM operation and release." width="1080" height="520" /></a><figcaption>The last arriving thread determines when global synchronization completes.</figcaption></figure>

## A safepoint has multiple phases

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

**TTSP is not the same as the duration of the VM operation itself.** During synchronization, early arrivals may already be stopped while the last thread still runs. The `Reaching safepoint` field therefore is <mark>not an exact interval during which every Java thread is simultaneously stopped</mark>. Treat a request’s observed delay as a correlation question, not a direct copy of a log duration.

This distinction is implemented directly in JDK 25's `SafepointSynchronize` and `SafepointTracing` code. [GitHub](https://raw.githubusercontent.com/openjdk/jdk/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp)


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable the reaching phase and vm-operation phase answer different diagnostic questions."><a href="/images/courses/jvm/safepoint-three-phases.svg" aria-label="Open the reaching phase and vm-operation phase answer different diagnostic questions."><img src="/images/courses/jvm/safepoint-three-phases.svg" alt="Three adjacent timing bars show 18 milliseconds reaching, 4 milliseconds at, and 0.1 milliseconds leaving for a total of 22.1 milliseconds." width="1080" height="520" /></a><figcaption>The reaching phase and VM-operation phase answer different diagnostic questions; bar widths are schematic, not to scale.</figcaption></figure>

## How Java threads reach safepoints

Recall our earlier lessons on bytecode execution and JIT compilation.

HotSpot uses different mechanisms depending on the thread's execution state.

### Interpreted execution

The interpreter checks for safepoint requests at appropriate execution points as it executes bytecode templates. A poll is an opportunity to cooperate, not an assertion that the VM stops after every bytecode.

### JIT-compiled execution

C2-compiled code contains safepoint polls at selected sites, often including loop back edges and return or call boundaries where the compiler can describe live state. The exact layout depends on compilation and platform.

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

A thread in native or blocked state may already be safepoint-safe; a transition back into Java must check whether a safepoint is in progress before it resumes Java execution. This avoids requiring every thread to actively execute a poll at the instant of the request.

The JDK 25 implementation documents these cases in `SafepointSynchronize::arm_safepoint()`. [GitHub](https://raw.githubusercontent.com/openjdk/jdk/jdk-25-ga/src/hotspot/share/runtime/safepoint.cpp)


## Why reaching a safepoint can take longer than expected

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

The `System.arraycopy` intrinsic is an illustrative poll-gap mechanism, <strong>not a guaranteed reproducer</strong>: size, platform, selected stub, compiler tier and JVM build determine the generated path. CPU descheduling can also postpone the last thread even when code has adequate polls.

This illustrates an important trade-off:

**Highly optimized machine code must balance execution efficiency with the JVM's need for cooperative runtime coordination.**

HotSpot inserts polls strategically rather than after every machine instruction.

Too many polls increase execution overhead. Too few can increase safepoint synchronization latency.


## Reading JDK 25 safepoint logs

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

JDK 25’s [`SafepointTracing::end()`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/safepoint.cpp) emits these exact timing categories. The 18 + 4 + 0.1 = 22.1 ms example is illustrative; it is not output measured from this page. <mark>A long reaching phase points to coordination; a long at-safepoint phase points to the VM operation.</mark>


## Diagnosing non-GC safepoints

Now consider another illustrative entry:

```text
Safepoint "PrintThreads",
Reaching safepoint: 200000 ns,
At safepoint: 8000000 ns,
Leaving safepoint: 100000 ns,
Total: 8300000 ns
```

Here, the named operation is associated with thread inspection rather than garbage collection. This is an illustrative *possible* VM operation, not a claim that all thread dumps require a global safepoint.

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


<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable align request, gc, safepoint and scheduling evidence before assigning cause."><a href="/images/courses/jvm/safepoint-production-correlation.svg" aria-label="Open align request, gc, safepoint and scheduling evidence before assigning cause."><img src="/images/courses/jvm/safepoint-production-correlation.svg" alt="A shared time axis aligns an 80 millisecond request spike, a 5 millisecond GC pause, an 18 millisecond reaching interval, a 4 millisecond VM operation, and a CPU scheduling delay." width="1080" height="520" /></a><figcaption>Align request, GC, safepoint and scheduling evidence before assigning cause; the schematic bars are not duration-scaled.</figcaption></figure>

## Hands-on: correlate GC and safepoint activity

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

Use this optional logging selector when you need aggregate safepoint statistics as well as individual entries. Read its output with the running JDK’s labels; do not substitute it for the per-event `Reaching`, `At`, and `Leaving` fields.

### Investigating an already-running JVM

You can enable safepoint logging dynamically:

```bash
jcmd <pid> VM.log what=safepoint=info
```

This is useful when investigating unexplained latency without restarting the application.

### JFR correlation and configuration

Start a bounded recording on the JVM you are diagnosing, then list the available events before printing selected records:

```bash
jcmd <pid> JFR.start name=safepoints settings=profile duration=120s filename=/tmp/safepoints.jfr
jfr summary /tmp/safepoints.jfr
jfr print --events jdk.SafepointBegin,jdk.ExecuteVMOperation /tmp/safepoints.jfr
```

In the **JDK 25 `profile.jfc` file**, `jdk.SafepointBegin` and `jdk.ExecuteVMOperation` are enabled. `jdk.SafepointStateSynchronization`, `jdk.SafepointEnd`, and `jdk.SafepointLatency` are disabled. A missing event therefore does not show that no safepoint occurred. To collect the disabled events, derive a custom JFR configuration from the [JDK 25 profile](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.jfr/share/conf/jfr/profile.jfc), enable the desired event entries, and pass that configuration to `JFR.start`; keep unified safepoint logging for the exact phase durations.

JEP 518’s `jdk.SafepointLatency` concerns **cooperative JFR sampling**. It is not a record of global time-to-safepoint for every VM operation. The event name alone is insufficient to identify its measurement boundary.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable a handshake targets selected threads; a global safepoint coordinates the set required by its operation."><a href="/images/courses/jvm/global-safepoint-vs-handshake.svg" aria-label="Open a handshake targets selected threads; a global safepoint coordinates the set required by its operation."><img src="/images/courses/jvm/global-safepoint-vs-handshake.svg" alt="A global operation waits for threads A through D; a targeted handshake coordinates only thread B while the others continue." width="1080" height="520" /></a><figcaption>A handshake targets selected threads; a global safepoint coordinates the set required by its operation.</figcaption></figure>

## Global safepoints versus thread-local handshakes

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


## Production implications

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

Check clock alignment, request traces, GC and safepoint log decorators, VM operation name and OS scheduling data. An overlapping safepoint is evidence of a possible contributor, not proof that it explains the entire p99 increase. Avoid changing GC parameters until you know which component is responsible.


<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Read the reaching and at-safepoint times separately before changing GC settings. Correlate them with request and scheduling timestamps; overlap alone does not establish the entire latency cause.</p></aside>

## Read one JDK 25 source path

At the immutable [`jdk-25+36` source tag](https://github.com/openjdk/jdk/tree/jdk-25%2B36), start in [`src/hotspot/share/runtime/safepoint.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/safepoint.cpp). `SafepointSynchronize::arm_safepoint()` shows how the VM asks Java threads to cooperate; `SafepointTracing::synchronized()` records when synchronization finishes; `SafepointTracing::end()` formats reaching, at, leaving and total timing. These source points explain why the log separates waiting for threads from executing the requested VM operation. They do not define a JVM-wide specification guarantee for other implementations.

## Check your reasoning

<details class="lesson-check"><summary>Three threads stop at 2 ms and the last stops at 18 ms. Were all threads stopped for 18 ms?</summary><p>No. Early arrivals waited while the last thread still ran or was delayed. The common stopped interval starts only after the final relevant thread becomes safe.</p></details>
<details class="lesson-check"><summary>A log shows 18 ms reaching and 4 ms at the safepoint. Which part should you investigate first?</summary><p>Investigate the late-arriving thread or scheduling during synchronization first. The VM operation accounts for only the 4 ms at-safepoint field in this illustrative entry.</p></details>
<details class="lesson-check"><summary>GC pauses are under 5 ms but a safepoint interval is 22 ms. Is the log inconsistent?</summary><p>No. Reaching and leaving contribute to the complete interval, and a non-GC VM operation may also request a safepoint.</p></details>
<details class="lesson-check"><summary>A thread is blocked in native code. Must it execute a compiled poll immediately?</summary><p>No. HotSpot can treat a suitable native or blocked state as safe and checks the transition before that thread returns to Java.</p></details>
<details class="lesson-check"><summary>Does an absent `jdk.SafepointStateSynchronization` event in a profile recording prove no safepoints occurred?</summary><p>No. JDK 25 profile.jfc disables that event by default. Check the recording configuration and unified safepoint logs.</p></details>
<details class="lesson-check"><summary>Must every thread dump stop the whole JVM?</summary><p>No. Some diagnostic work can use thread-local handshakes. Confirm the actual operation and the evidence for the running JDK.</p></details>

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

Continue with [Lesson 56, *Deoptimization in production*](/courses/jvm/deoptimization-in-production) to see how a compiled thread recovers when speculative JIT assumptions fail, and why that event need not be a global safepoint.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #55 and its approved technical review. Timelines, durations, diagrams and production cases are illustrative; OpenJDK 25.0.2 accepted the three unified-logging selectors in a local launch check; no production JVM recording was made for this lesson. Safepoint and JFR details describe JDK 25 HotSpot, not a Java-language guarantee.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/safepoint.cpp">OpenJDK jdk-25+36 safepoint.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.jfr/share/conf/jfr/profile.jfc">OpenJDK jdk-25+36 profile.jfc</a></li><li><a href="https://openjdk.org/jeps/518">JEP 518: JFR Cooperative Sampling</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher and unified logging reference</a></li></ul></details>
