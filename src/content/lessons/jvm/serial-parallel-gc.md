---
title: Serial GC and Parallel GC — simplicity vs throughput
summary: See why stop-the-world collectors still suit some workloads, how Serial and Parallel GC execute generational collections, and how to choose among JDK 25 collectors by workload goals.
course: jvm
lessonSlug: serial-parallel-gc
module: Garbage Collection
order: 280
sourceByte: byte-028
draft: true
prerequisites: [zgc-jdk-25]
jdk: JDK 25 · HotSpot Serial and Parallel GC
---

In [Lesson 27](/courses/jvm/zgc-jdk-25), ZGC moved much of its collection work alongside running application threads. G1 also overlaps marking with application work. It is tempting to turn that sequence into a ranking: more concurrency must mean a better collector. But a nightly data job, a tiny command-line tool, and a latency-sensitive API pay for GC in different ways. <mark>The useful collector is the one whose costs fit the workload's latency, throughput, memory, and CPU goals.</mark>

JDK 25 HotSpot still offers Serial, Parallel, G1, and ZGC. The first two accept stop-the-world (STW) collection: application threads pause while collection work runs. They remain useful because overlapping work and coordinating many workers have costs of their own. [JDK 25 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html)

<figure><a href="/images/courses/jvm/gc-collector-objectives.svg" aria-label="Open collector objectives diagram"><img src="/images/courses/jvm/gc-collector-objectives.svg" alt="Three workload goals, low coordination cost, high overall application throughput, and low pause latency, point to different collector choices." width="900" height="450" /></a><figcaption>Collector choice begins with the cost the application can afford, rather than a universal ranking.</figcaption></figure>

## Serial keeps the collection job small

Select Serial GC with `-XX:+UseSerialGC`. When it collects, application threads stop and **one GC worker** does the work. There is no team of collection workers to coordinate and no concurrent marking cycle competing with application execution. That simple execution model can be efficient for small heaps or data sets, single-CPU or CPU-constrained environments, short-lived utilities, and small JVM processes. Oracle specifically calls out small data sets and single-processor machines. These are starting points to measure, not a promise that Serial wins every small workload. [JDK 25 collector guide](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html)

“Serial” describes **how collection work executes**. The heap is still generational: new objects normally enter Eden, surviving young objects can move through Survivor space, and longer-lived objects can be promoted into Old. A young collection reclaims dead young objects; an old or full collection handles older objects when needed. The exact timing depends on allocation and heap pressure. [JDK 25 serial collector](https://docs.oracle.com/en/java/javase/25/gctuning/serial-collector1.html)

<figure><a href="/images/courses/jvm/serial-generational.svg" aria-label="Open Serial generational heap diagram"><img src="/images/courses/jvm/serial-generational.svg" alt="Objects enter Eden, young survivors pass through Survivor space, and longer-lived objects can reach Old; a single GC worker performs collection while application threads are stopped." width="900" height="450" /></a><figcaption>Generations describe object lifetime; Serial describes the single-worker collection execution.</figcaption></figure>

Why might one worker beat several? Imagine a tiny heap with little live data. A single worker can scan and copy the small survivor set quickly. Starting several workers, dividing work, and coordinating completion can consume a meaningful fraction of that short job. Parallelism pays when enough collection work exists to amortize that coordination. The crossover depends on the heap, live set, CPUs, and machine; it is an empirical result, not a fixed heap-size threshold.

<figure><a href="/images/courses/jvm/serial-vs-parallel-small-heap.svg" aria-label="Open small collection comparison"><img src="/images/courses/jvm/serial-vs-parallel-small-heap.svg" alt="For a small illustrative collection, one worker has only collection work while multiple workers also pay startup and coordination costs; at larger work sizes the parallel workers can recover that overhead." width="900" height="450" /></a><figcaption>For a sufficiently small GC job, worker coordination can outweigh the time saved by sharing the work.</figcaption></figure>

## Parallel spends more CPU to finish a pause sooner

Select Parallel GC with `-XX:+UseParallelGC`. It is also generational, and collection remains primarily STW, but HotSpot spreads young and major collection work across multiple GC workers. Oracle calls it the **Throughput Collector** because it is designed to minimize the share of total execution time spent in GC, especially for substantial data sets on multiprocessor machines. [JDK 25 Parallel collector](https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html)

<figure><a href="/images/courses/jvm/parallel-gc-workers.svg" aria-label="Open Parallel GC worker diagram"><img src="/images/courses/jvm/parallel-gc-workers.svg" alt="Application threads pause; several GC workers divide young or major collection work; application threads resume after all workers finish." width="900" height="450" /></a><figcaption>Several workers can shorten a collection pause when there is enough useful work to divide.</figcaption></figure>

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea"><p class="callout-label">Key idea</p><p><strong>Parallel</strong> means multiple GC workers run at the same time while application threads are stopped. <strong>Concurrent</strong> means some GC work overlaps application execution. G1 and ZGC can use parallel workers too; these terms describe different axes.</p></aside>

<figure><a href="/images/courses/jvm/parallel-vs-concurrent-gc.svg" aria-label="Open parallel versus concurrent GC timeline"><img src="/images/courses/jvm/parallel-vs-concurrent-gc.svg" alt="Parallel GC timeline shows application stopped while several GC workers run; concurrent GC timeline shows application and collector activity overlapping, with short coordination pauses still possible." width="900" height="450" /></a><figcaption>The distinction is whether mutators run during the GC work, not simply the number of GC threads.</figcaption></figure>

## Throughput and latency answer different questions

For a job's observed runtime, a useful throughput fraction is:

```text
application time / (application time + GC time)
```

If a batch run spends 990 seconds doing application work and 10 seconds in GC, that fraction is 99%. The ratio describes time allocation, not records processed per second by itself. **Latency** asks how long an individual request or pause takes; **tail latency** asks about the slow end of that distribution, such as the 99th percentile. A collector can produce a good application-time fraction and still cause pauses unacceptable to an interactive service.

Consider a nightly report that processes a fixed input. Suppose an illustrative Parallel GC run finishes in 50 minutes with occasional 800 ms pauses, while a low-pause configuration finishes in 55 minutes. If nobody is waiting on an individual response and the deadline is one hour, the first run can be the better operational result. These numbers are a thought experiment, not a benchmark. A user-facing request path with a 100 ms tail-latency target would evaluate the same pauses very differently.

<aside class="lesson-callout" data-kind="important" aria-label="Important"><p class="callout-label">Important</p><p>Choose with the actual workload: latency and tail-latency targets, total job throughput, heap and live-set size, CPU and memory budgets, and deployment environment. A nightly batch, tiny CLI, and interactive service can reasonably choose different collectors.</p></aside>

## Parallel GC tunes toward goals

Parallel GC selects a worker count ergonomically from the processors HotSpot sees; `-XX:ParallelGCThreads=N` overrides that count. More workers can reduce wall-clock collection time when enough CPU and memory bandwidth are available, but they consume CPU during the pause and add coordination. A container CPU limit can change the processor count visible to HotSpot and therefore the chosen worker count. Inspect that effective count and GC logs in the deployed environment before assuming host-wide CPU capacity. [JDK 25 Parallel collector](https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html), [JDK 25 `java` command](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>A collector selected or sized on a developer machine can behave differently under a container CPU quota or memory limit. Check the collector, effective processor count, heap limits, and observed pause and throughput data in the actual deployment before fixing a worker count.</p></aside>

Its adaptive sizing policy balances three goals. `-XX:MaxGCPauseMillis=N` supplies a pause-time goal. `-XX:GCTimeRatio=N` supplies a throughput goal: the model targets GC time as `1 / (1 + N)` of total time. The default `99` therefore means roughly **1% GC time** and 99% application time under that model. Finally, the collector tries to minimize footprint, within the maximum heap set by `-Xmx`, after the other goals. The documented priority is pause goal, then throughput, then footprint. These are heuristic targets; `MaxGCPauseMillis` is not a hard real-time bound. [JDK 25 Parallel collector](https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html)

Adaptive generation sizing is one way it pursues these goals. A larger young generation can collect less often and improve throughput, but each young collection may have more objects to examine and can pause longer. A smaller generation may shorten an individual collection while increasing frequency. Old-generation size similarly affects major collection frequency, work, and available memory. The adaptive policy uses observed collections to adjust generation sizes; a change may help one goal while hurting another. [JDK 25 Parallel collector](https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html)

<figure><a href="/images/courses/jvm/parallel-gc-sizing-tradeoff.svg" aria-label="Open generation sizing trade-off"><img src="/images/courses/jvm/parallel-gc-sizing-tradeoff.svg" alt="Smaller generations show more frequent potentially shorter collections; larger generations show fewer potentially longer collections, with adaptive sizing balancing pause, throughput, and footprint goals." width="900" height="450" /></a><figcaption>Generation size changes both how often collection happens and how much work may be waiting at each collection.</figcaption></figure>

## Four collectors, four cost profiles

<figure><a href="/images/courses/jvm/jdk25-collector-comparison.svg" aria-label="Open JDK 25 collector comparison"><img src="/images/courses/jvm/jdk25-collector-comparison.svg" alt="Serial emphasizes low coordination overhead for small work; Parallel emphasizes throughput; G1 balances throughput and pause goals; ZGC emphasizes very low pause latency." width="900" height="450" /></a><figcaption>JDK 25 collectors occupy different cost profiles; the diagram is not a best-to-worst scale.</figcaption></figure>

<div class="lesson-table-scroll" role="region" aria-label="JDK 25 collector choices" tabindex="0"><table class="lesson-comparison"><caption>Starting points for a measured collector choice.</caption><thead><tr><th scope="col">Collector</th><th scope="col">Primary appeal</th><th scope="col">Example fit</th></tr></thead><tbody><tr><th scope="row">Serial</th><td>Simple execution and low GC coordination overhead</td><td>Tiny CLI, small data set, constrained CPU</td></tr><tr><th scope="row">Parallel</th><td>Overall application throughput</td><td>Nightly batch with pause tolerance</td></tr><tr><th scope="row">G1</th><td>Balance high throughput with pause goals</td><td>Service with moderate pause target</td></tr><tr><th scope="row">ZGC</th><td>Very low pause latency</td><td>Latency-sensitive service with enough CPU and heap headroom</td></tr></tbody></table></div>

<figure><a href="/images/courses/jvm/gc-concurrency-spectrum.svg" aria-label="Open GC execution spectrum"><img src="/images/courses/jvm/gc-concurrency-spectrum.svg" alt="Serial and Parallel run collection mainly during application pauses; G1 overlaps marking but evacuates during pauses; ZGC overlaps marking and relocation with application work while retaining short coordination pauses." width="900" height="450" /></a><figcaption>Concurrency describes where work lands in time. It does not rank total cost or suitability.</figcaption></figure>

## Check your reasoning

<details class="lesson-check"><summary>Why can Serial GC win for a tiny heap even with only one GC worker?</summary><p>The collection job may be so small that dividing it and coordinating workers costs more than one worker needs to complete it. Measure the actual workload; heap size alone does not establish the crossover.</p></details>

<details class="lesson-check"><summary>Parallel GC uses several workers. Does the application run during its collection?</summary><p>Usually no. Parallel GC is primarily stop-the-world: its workers run together while mutators are paused. Parallel and concurrent describe different properties.</p></details>

<details class="lesson-check"><summary>What does GCTimeRatio=99 aim for, and what does it guarantee?</summary><p>Its model aims for GC time of 1/(1+99), roughly 1% of total time. It is an adaptive goal, not a guarantee for each run or pause.</p></details>

<details class="lesson-check"><summary>Why might a nightly batch accept an 800 ms GC pause that an API rejects?</summary><p>The batch's success measure can be total completion time. The API may have an individual request or tail-latency target far below that pause duration.</p></details>

## From collector architecture to heap sizing

<mark>Concurrency, worker count, and generations move GC cost around; they do not remove the need to budget CPU, memory, and time.</mark> We have now met the four JDK 25 collector architectures. The [next lesson, GC ergonomics and heap sizing](/courses/jvm/gc-ergonomics-heap-sizing) turns to `-Xms`, `-Xmx`, young sizing, live set, allocation rate, and headroom. A larger heap can reduce collection frequency and help throughput while leaving more work for some pauses; the right capacity follows the workload and collector.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #28 and the reviewed lesson requirements. Durations, workloads, and SVGs are conceptual examples, not measured benchmarks. No JDK 25 GC workload was executed for this lesson. Collector behavior and flags describe HotSpot in JDK 25, not Java language guarantees or other JVM implementations.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html">JDK 25 available collectors and selection guidance</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/serial-collector1.html">JDK 25 Serial collector</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/parallel-collector1.html">JDK 25 Parallel collector, workers, goals, and adaptive sizing</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 collector</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html">JDK 25 ZGC</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher and container support</a></li></ul></details>
