---
title: JVM diagnostics as a system — choosing the right observation layer
summary: Investigate JVM incidents by choosing the observation layer that can answer the next question, then checking each hypothesis against independent evidence.
course: jvm
lessonSlug: jvm-diagnostics-system
module: Production Diagnostics
order: 390
sourceByte: byte-039
draft: true
prerequisites:
  - jvm-crash-anatomy
jdk: JDK 25 · Production Diagnostics
---

A production incident rarely arrives with a tool name. It arrives as a stalled request, a CPU alert, growing memory, or a restarted container. Earlier lessons showed how to read [GC logs](/courses/jvm/reading-gc-logs-jdk-25), inspect [native memory](/courses/jvm/native-memory-tracking), and classify a [JVM crash](/courses/jvm/jvm-crash-anatomy). The next skill is deciding which evidence to collect first.

Imagine a service whose response time jumps from 80 ms to two seconds. A heap dump might find a large cache, but that says little about whether the slow request waited on a lock, a database, GC, or a CPU quota. Begin with the question the symptom actually raises: **where was the request's time spent?**

<mark>No one diagnostic tool observes every layer; choose the smallest observation layer that can answer the next question.</mark> Then compare its answer with another observation before calling it a cause.

## The layers we can observe

The application reports requests and errors. Execution evidence describes threads, stacks, locks, and CPU samples. Heap evidence describes objects and their references. HotSpot reports GC, compilation, class metadata, and its own native allocations. Process and container measurements describe resident memory, CPU, I/O, limits, and external termination. These views overlap, but their boundaries differ.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM diagnostic observation layers"><a href="/images/courses/jvm/jvm-diagnostic-observation-layers.svg" aria-label="Open diagnostic observation layers"><img src="/images/courses/jvm/jvm-diagnostic-observation-layers.svg" alt="Six observation layers connect application telemetry, execution, heap, HotSpot, native process, and OS or container evidence; each layer answers a different question." width="960" height="620" /></a><figcaption>Choose a view for the next question, then cross-check where the views meet.</figcaption></figure>

For example, **heap used**, **process RSS** (resident physical pages), and **container memory charged to a cgroup** can all rise by different amounts. Treating them as one number can send an investigation to the wrong subsystem. Likewise, a thread shown as `RUNNABLE` is eligible to run or executing in JVM terms; the state alone does not prove that it consumed CPU during the incident.

## `jcmd` opens several doors

`jcmd <pid> help` lists commands supported by the target VM. It is an entry point into HotSpot diagnostics, not a single measurement. The same interface can request `Thread.print`, `Thread.dump_to_file`, `GC.class_histogram`, `GC.heap_dump`, `JFR.start`, `JFR.dump`, `VM.native_memory`, `Compiler.codecache`, and `VM.classloader_stats`. Each invokes a different subsystem, answers a different question, and has its own cost. Check the command's help and impact for the running JDK before using it on a busy service.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable jcmd control plane"><a href="/images/courses/jvm/jcmd-diagnostic-control-plane.svg" aria-label="Open jcmd diagnostic control plane"><img src="/images/courses/jvm/jcmd-diagnostic-control-plane.svg" alt="jcmd branches to thread snapshots, JFR recordings, heap census and dump, NMT, compiler diagnostics, and loader statistics; the operations have separate costs." width="960" height="460" /></a><figcaption>`jcmd` selects an operation; its name alone says nothing about the operation's disturbance.</figcaption></figure>

## Execution now, execution over time

When the service is stuck **right now**, `jcmd <pid> Thread.print` supplies a point-in-time view of platform-thread stacks, states, and locks. A `BLOCKED` worker awaiting one monitor may be a lead. One dump cannot show whether that stack lasted a microsecond or ten minutes. Capture appropriately spaced snapshots and compare them with request timing, lock events, and per-thread OS CPU. A hot stack recurring in multiple dumps is stronger evidence than a single `RUNNABLE` line, though even repeated samples are not a complete trace.

Virtual threads change the picture. A virtual thread can unmount from one carrier and later resume on another; it has no permanent one-to-one `JavaThread` or OS thread. In JDK 25, use the virtual-thread-aware file dump when you need that view:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json
```

The traditional `Thread.print` remains useful for platform threads and VM activity. The file dump makes many virtual-thread stacks visible without pretending each has its own OS thread. Both operations can have meaningful cost when thread counts are large.

For an interval, start Java Flight Recorder (JFR):

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=2m filename=/tmp/incident.jfr
```

Open the recording in Java Mission Control (JMC). Depending on event settings, it can show execution samples, allocations, GC pauses, lock contention, parks, and I/O. <mark>A thread dump says what was visible at an instant; JFR connects configured events across time.</mark> Samples and enabled events are **not** a lossless record of every instruction or allocation. If the incident ended before you attached, historical application telemetry and an already running JFR recording may be more valuable than a fresh snapshot. Match timestamps and configuration before inferring a causal sequence.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable thread dump and JFR comparison"><a href="/images/courses/jvm/thread-dump-vs-jfr.svg" aria-label="Open thread dump and JFR comparison"><img src="/images/courses/jvm/thread-dump-vs-jfr.svg" alt="A thread dump is one vertical time slice; JFR places sampled CPU, lock, GC, and I/O events on a timeline." width="960" height="450" /></a><figcaption>Use snapshots for a live stall and interval evidence for recurrence, duration, and order.</figcaption></figure>

## Object population, then retention

If post-GC heap occupancy or a specific object population grows, a class histogram counts instances and shallow bytes by class. Compare observations at comparable workload points to see whether, for example, `byte[]` or `Order` counts are rising. The counts do not identify who retains an object. A heap dump supplies the reference graph for paths to GC roots, dominators, and retained size. A cache may have a small shallow size while retaining a large graph below it.

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>JDK 25 rates both <code>GC.class_histogram</code> and <code>GC.heap_dump</code> as high impact. A histogram is a smaller kind of answer, not an automatically cheap operation. A heap dump normally requests a Full GC unless <code>-all</code> is used, and it can consume substantial time and disk. Estimate impact from heap size, workload, and configuration before running either.</p></aside>

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable heap histogram and heap dump comparison"><a href="/images/courses/jvm/heap-histogram-vs-heap-dump.svg" aria-label="Open heap histogram and heap dump comparison"><img src="/images/courses/jvm/heap-histogram-vs-heap-dump.svg" alt="A histogram counts classes and shallow bytes; a heap dump preserves object references and supports roots, dominators, and retained size." width="960" height="430" /></a><figcaption>Move to the reference graph when the question changes from “how many?” to “who keeps them alive?”</figcaption></figure>

## Collector, native, and outer-process evidence

GC logs give a timeline of collection cadence, pauses, promotion, available headroom, and, for G1, concurrent and mixed cycles. Align pause timestamps and durations with application latency. A pause near a slow request is a hypothesis, not proof: the request may have spent most of its time elsewhere. JFR and request traces can test the timing more precisely.

Native Memory Tracking (NMT), when enabled, groups HotSpot accounting into categories such as Java Heap, Class, Thread, Code, and GC. It includes heap reservation and commitment; it does not report heap **used** as a substitute for a heap analyzer. Establish a baseline and compare later:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

NMT does not cover arbitrary third-party native allocations and its totals are not OS RSS. If RSS rises without a corresponding NMT change, inspect mappings, native libraries, direct or mapped buffers, allocator behavior, and OS/container accounting. At the outer boundary, check process CPU and thread CPU, RSS, I/O and page faults, cgroup memory charges and limits, CPU throttling, and supervisor or Kubernetes termination records. An `OOMKilled` last state points to an external memory kill; a healthy heap does not contradict it.

## Begin with a question

| Production question | Useful first evidence | Escalate when the answer is incomplete |
|---|---|---|
| Why is CPU high? | Process and thread CPU; JFR samples | GC and compiler events, native profiling |
| Why is the service stuck now? | Thread dump and request state | Repeated dumps, locks, JFR |
| Why was latency high earlier? | Historical telemetry and JFR | GC logs, traces, I/O and throttling |
| Which objects are growing? | Heap trend; class histogram | Heap dump for retention |
| Why are objects retained? | Heap dump | Root paths and dominator analysis |
| Is GC causing latency? | GC logs and JFR | Request timestamp correlation |
| Is HotSpot native memory growing? | NMT baseline and diff | Detail view and subsystem evidence |
| Why is RSS growing? | OS RSS and mappings; NMT | Native allocation and cgroup evidence |
| Why did the JVM crash? | `hs_err` and termination record | Core dump and native debugger |
| Why was the container killed? | Termination reason and cgroup metrics | Node and OS memory evidence |

The **first** column prevents the tool menu from becoming the plan. Tool disturbance has no reliable universal ranking: recording settings, heap size, thread count, disk speed, and current load all matter.

## Case study: high CPU

Monitoring shows 95% CPU. Confirm that it is this process rather than a neighboring workload, and check whether a CPU quota is throttling it. Then compare OS thread CPU with JFR execution samples and runtime events. If application frames dominate repeated samples, inspect and reproduce the hot algorithm. If GC workers dominate and GC logs show frequent collections, investigate allocation rate and live-set headroom. If compiler threads dominate, examine compilation and warm-up evidence. Native library work may require an OS profiler. Each path needs independent confirmation before code changes or tuning: <mark>the same CPU symptom can arise from different subsystems.</mark>

## Case study: RSS rises while post-GC heap stays stable

Suppose RSS goes from 4 to 6 GB while the heap after GC stays near 2.1 GB. Confirm the same process and comparable measurement times. A retention dump is not yet justified by this evidence. Compare NMT baseline and diff: rising **Thread** suggests checking platform-thread counts and stacks; rising **Class** suggests loader and Metaspace investigation; rising **Code** suggests compiler and Code Cache evidence. If NMT remains flat, inspect native allocation, file mappings, and container charges. Verify the selected hypothesis with a second view, such as thread count, loader statistics, code-cache output, or mapping growth. Only then choose a corrective action.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable JVM diagnostic escalation"><a href="/images/courses/jvm/jvm-diagnostic-escalation.svg" aria-label="Open diagnostic escalation workflow"><img src="/images/courses/jvm/jvm-diagnostic-escalation.svg" alt="The investigation flows from symptom to metrics, suspected subsystem, targeted evidence, hypothesis, independent verification, and corrective action, with a loop back when evidence disagrees." width="960" height="520" /></a><figcaption>Let each observation decide the next step. Disagreement sends the investigation back to the hypothesis.</figcaption></figure>

## Check your reasoning

<details class="lesson-check"><summary>A worker is RUNNABLE in one dump, RSS is growing, and a GC pause occurs near one slow request. Which conclusions are established?</summary><p>None of those observations alone establishes the worker's CPU consumption, heap retention, or GC causation. Match OS thread CPU or JFR samples to the worker; compare post-GC heap, NMT, and mappings for RSS; align request and pause intervals before attributing latency.</p></details>

The complete investigation is **symptom → confirm with metrics → suspected subsystem → targeted evidence → hypothesis → independent verification → corrective action**. In the next lesson, the observation layers become a map of cooperating HotSpot C++ structures: class metadata, methods, compiled code, threads, and GC reference maps.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Daily JVM Byte #39 and its approved review supply the editorial structure. Values, incidents, and diagrams are illustrative; the commands were checked against JDK 25 documentation but not run against a production process. Tool impact and available events depend on the target JDK, workload, and configuration; NMT is HotSpot accounting, while OS and cgroup figures have different boundaries.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd command reference and impact ratings</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 Java launcher: JFR, GC logging, and NMT options</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshooting-guide.pdf">JDK 25 Troubleshooting Guide</a></li><li><a href="https://openjdk.org/jeps/444">JEP 444: virtual threads and observability</a></li></ul></details>
