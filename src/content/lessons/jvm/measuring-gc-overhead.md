---
title: Measuring GC overhead beyond pause times
summary: Measure stop-the-world time, concurrent collector CPU, mutator work and allocation stalls alongside real application latency.
course: jvm
lessonSlug: measuring-gc-overhead
module: HotSpot Internals
order: 500
sourceByte: byte-050
draft: true
prerequisites:
  - gc-barriers-in-jit-code
jdk: JDK 25 · G1 and Generational ZGC
---

[Lesson 49](/courses/jvm/gc-barriers-in-jit-code) followed a reference access into JIT-generated machine code. Its collector barrier can execute on the application thread even when no global GC pause is happening. That gives us a practical question: **what should we measure to learn how much GC costs a service?**

Consider two runs of the same workload. Every number in this table is **illustrative**, not a benchmark result.

| Metric | G1 | ZGC |
|---|---:|---:|
| Maximum GC pause | 25 ms | 1 ms |
| Process CPU utilization | 60% | 78% |
| Throughput | 12,000 requests/s | 11,000 requests/s |
| Application p99 latency | 45 ms | 30 ms |

ZGC wins on this tail-latency objective; G1 completes more work with less CPU. Neither maximum pause nor one process-wide CPU percentage selects a collector for every service. Oracle's [JDK 25 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html) describes this throughput, latency and resource trade-off.

## Four places where the cost appears

**Stop-the-world (STW) time** is elapsed time during which Java mutator threads cannot make normal progress. **Concurrent collector CPU** is work by GC threads while mutators continue. **Mutator-side overhead** includes collector barriers and allocation bookkeeping run by application threads. **Allocation stalls** are time a mutator waits because allocation cannot proceed until space or collector progress becomes available.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable four dimensions of GC cost"><a href="/images/courses/jvm/gc-overhead-four-dimensions.svg" aria-label="Open four dimensions diagram"><img src="/images/courses/jvm/gc-overhead-four-dimensions.svg" alt="A GC-cost map places global pauses and allocation stalls on elapsed application time, concurrent workers on collector CPU, and barriers on mutator CPU; overlapping bands warn against adding the numbers." width="1080" height="500" /></a><figcaption>These are observation boundaries, not four independent quantities to sum.</figcaption></figure>

<mark>The four costs overlap in time and in accounting; adding their reported values can double-count work.</mark> Concurrent GC CPU competes with mutators but can overlap their wall-clock execution. Barrier instructions are charged to mutator CPU. An allocation stall may overlap a concurrent phase. Process CPU aggregates application execution, GC workers, JIT compiler threads and other VM activity.

## Start with elapsed pause fraction

Suppose 20 young collections average 30 ms over a 60-second interval. Their total pause duration is `20 × 30 ms = 600 ms`, and the STW fraction is `600 / 60,000 = 1%`. This describes elapsed time spent in those pauses. It does **not** say that GC used 1% of CPU or that each request gained exactly 1% latency. One 300 ms pause and thirty 10 ms pauses have different effects on request tails, even if their summed durations match.

Pause logs can also report a line like this **illustrative** one:

```text
[info][gc,cpu] GC(42) User=0.19s Sys=0.00s Real=0.03s
```

`User` is user-mode CPU accumulated across participating threads, `Sys` is kernel-mode CPU, and `Real` is elapsed wall-clock time. Several pause workers can consume 190 ms of combined CPU within a 30 ms wall-clock pause by running in parallel. That `gc,cpu` line measures the logged operation; it does not account for every later concurrent worker cycle or isolate barriers in application code.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable CPU and wall-clock comparison"><a href="/images/courses/jvm/gc-cpu-vs-wall-clock.svg" aria-label="Open CPU versus wall-clock diagram"><img src="/images/courses/jvm/gc-cpu-vs-wall-clock.svg" alt="Four parallel worker tracks fit inside one 30 millisecond elapsed interval while their CPU times add to a larger total." width="1080" height="420" /></a><figcaption>CPU seconds sum work across cores; real seconds measure one interval on the clock.</figcaption></figure>

## Account for work while the application runs

G1's concurrent marking and ZGC's concurrent marking and relocation consume CPU capacity without necessarily making a long pause. In a four-core quota, GC workers and request threads may compete for the same four cores. High process CPU could be collector activity, JIT compilation, application work or a mixture. Thread-level CPU and phase timelines help attribute it; define the denominator when reporting CPU: percent of one core, percent of assigned cores, or absolute core-seconds.

The opposite accounting problem appears in mutator threads. In the earlier `customer.latestOrder = order` example, G1's conditional SATB and card work can execute alongside the Java store. ZGC reference barriers can also add fast-path instructions and occasional slow paths. A regular application-thread CPU profile may therefore contain collector-induced work. Compiler elimination means not every source-level reference access pays the same cost. Logs do not count every executed barrier, and a precise attribution can require a controlled benchmark and generated-code inspection.

Now imagine a concurrent collector with a maximum global pause of 0.7 ms, yet one request waits 120 ms at an allocation. The request can be delayed while the collector makes space, even though the pause metric stays tiny. <mark>Short global pauses do not guarantee short request latency.</mark> CPU throttling, locks, I/O and queueing can produce the same visible symptom, so an allocation stall needs corroborating collector and application evidence.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable request and GC timelines"><a href="/images/courses/jvm/gc-pause-vs-request-latency.svg" aria-label="Open request timeline diagram"><img src="/images/courses/jvm/gc-pause-vs-request-latency.svg" alt="A request timeline compares a G1 pause interruption with a ZGC run whose short global pause coexists with allocation waiting and CPU contention." width="1080" height="480" /></a><figcaption>Application p99 includes all waiting and execution, not just the longest GC pause.</figcaption></figure>

## Collect evidence on a shared timeline

For a controlled JDK 25 run, start with a fixed heap and unified logging:

```bash
java -Xms2g -Xmx2g -XX:+UseG1GC \
  -Xlog:gc*=info,safepoint=info:file=gc.log:time,uptime,level,tags \
  -jar application.jar
```

Substitute `-XX:+UseZGC` for the collector comparison. `gc+phases=debug` can expose more G1 pause-phase detail. Read event causes, pause durations, concurrent phases, `gc,cpu`, occupancy and allocation-stall messages where available. A log's wall-clock `time` and monotonic `uptime` decorations help you align events, but application traces and host clocks must use an agreed time basis. A near match between a slow request and a GC event suggests an investigation, not proof of causation.

Record a two-minute interval with Java Flight Recorder (JFR):

```bash
jcmd <pid> JFR.start name=gc-analysis settings=profile \
  duration=120s filename=/tmp/gc-analysis.jfr
jfr summary /tmp/gc-analysis.jfr
jfr print --events jdk.GCPhasePause,jdk.GCPhaseConcurrent,jdk.ThreadCPULoad \
  /tmp/gc-analysis.jfr
```

Open the same recording in JDK Mission Control for a timeline. `jdk.GCPhasePause` and `jdk.GCPhaseConcurrent` describe recorded phases; `jdk.ThreadCPULoad` and `jdk.CPULoad` add CPU context. `jdk.ObjectAllocationSample` identifies sampled allocation sources, **not every allocation**. Event availability and frequency depend on the JDK and recording settings; inspect `jfr summary` before interpreting a missing event. JFR does not separate application arithmetic from barrier instructions inside one compiled method. The [JDK 25 JFR troubleshooting guide](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html) explains this style of investigation.

## Compare collectors using application outcomes

Keep application build, exact JDK, workload mix, heap, CPU and memory limits, warmup and observation window comparable. Repeat runs to see variability. Record STW fraction and pause distribution; collector and process CPU; allocation rate, stalls and post-GC heap occupancy; completed requests; and real p99/p99.9 latency. These measurements answer different questions. A growing live set or insufficient headroom can change the result independently of pause policy.

Suppose a migration from G1 to ZGC changes maximum pause from 18 ms to 0.8 ms, but p99 rises from 45 ms to 80 ms and process CPU from 60% to 88%. Investigate in three levels. First confirm that the same requests and limits were measured after warmup. Next correlate request spikes with allocation stalls, concurrent phases and CPU throttling on a shared timeline. Finally compare thread CPU and application profiles to identify collector competition, mutator paths or another bottleneck. Do not declare the collector the cause from a single metric. If the service has strict p99 requirements, the final decision must use the request distribution, not the internal pause target.

## Check your reasoning

<details class="lesson-check"><summary>Twenty 30 ms pauses occur in one minute. Is GC CPU 1%?</summary><p>The STW fraction is 1% of elapsed time. Parallel pause CPU, concurrent GC CPU and mutator barriers are separate observations.</p></details>
<details class="lesson-check"><summary>Can 190 ms of user CPU fit inside a 30 ms pause?</summary><p>Yes. Parallel workers accumulate CPU time across cores during one 30 ms wall-clock interval.</p></details>
<details class="lesson-check"><summary>Where is ordinary barrier CPU charged?</summary><p>Usually to the application thread executing the generated reference access, so process or thread CPU alone does not isolate it.</p></details>
<details class="lesson-check"><summary>Does a 0.7 ms global pause rule out a 120 ms GC-related allocation delay?</summary><p>No. An allocation stall can wait for collector progress without a long global pause. Confirm the stall with logs or JFR and rule out other causes.</p></details>

The complete mental model is: **GC changes elapsed progress through pauses and stalls, consumes CPU through dedicated workers and mutator instructions, and ultimately matters through useful throughput and latency.** The measurements overlap; compare them on a common timeline. [Lesson 51](/courses/jvm/gc-ergonomics) asks why HotSpot changes its collector decisions as the workload changes.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on approved Daily JVM Byte #50 and its review. All tables, numeric examples and diagrams are illustrative; no workload was run for this lesson. Collector behavior and commands refer to JDK 25 HotSpot, not Java language guarantees. JFR events depend on recording configuration.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html">JDK 25 available collectors</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 collector</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html">JDK 25 JFR performance troubleshooting</a></li></ul></details>
