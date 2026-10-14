---
title: JVM warm-up vs. steady state — when is Java actually ready?
summary: Separate startup and readiness from workload-specific performance stabilization; measure JIT, GC, application initialization and tail latency with JDK 25 diagnostics.
course: jvm
lessonSlug: jvm-warmup-vs-steady-state
module: HotSpot Internals
order: 580
sourceByte: byte-058
draft: false
prerequisites:
  - jit-compilation-under-cpu-pressure
jdk: JDK 25 · Runtime warm-up and performance measurement
---

In [Lesson 57](/courses/jvm/jit-compilation-under-cpu-pressure), compiler threads competed with request threads for CPU while useful optimizations waited in queues. That raises a practical question: **when is a Java service ready for a trustworthy performance measurement?**

A Spring Boot log might say `Started Application in 4.2 seconds`. Its readiness probe might pass a moment later. Both are useful milestones. Neither reports that the code serving your particular mix of requests has settled into representative performance. Classes can load, profiles can change, C1 or C2 can compile, G1 can adjust its policy, and application caches or connections can fill while requests are already succeeding.

<mark>Startup, readiness and performance stabilization are three different observations.</mark> The last depends on the workload and can change again. This lesson follows those mechanisms, then builds a measurement and diagnostic method that can survive a rolling deployment.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable startup milestones diagram"><a href="/images/courses/jvm/jvm-startup-readiness-warmup.svg"><img src="/images/courses/jvm/jvm-startup-readiness-warmup.svg" alt="Timeline separates process start, application readiness, and a later workload-specific performance observation; adaptation continues after readiness." width="1080" height="440" /></a><figcaption>Readiness is an application decision; stable measurements require sustained representative traffic.</figcaption></figure>

## 1. What warm-up includes

**Warm-up** is the interval during which an application and its runtime acquire execution characteristics that can differ from later sustained operation. It is not a single HotSpot phase. A first request can load or initialize a class, create a lazy dependency, open a connection, execute bytecode in the interpreter, trigger a compiler task, allocate objects and return a response. A later identical request might reuse all of those results.

| Layer | Work that may continue after startup | Observable consequence |
|---|---|---|
| Class loading and initialization | First use of types and static initializers | First-path latency, metadata work |
| Interpreter and C1 | Execute bytecode; gather profiles and compile | Changing CPU cost per call |
| C2 and Code Cache | Optimize hot paths; install native code | Later calls may run differently |
| Garbage collector | Observe allocation, survival and marking | Changing pause, CPU and heap behavior |
| Application | Fill caches, build lazy objects, establish pools | Latency unrelated to JIT |
| External systems | DNS, TLS, database or remote service setup | Time outside HotSpot's adaptation |

Startup means the framework finished its startup procedure. Readiness means the configured probe says this instance can receive traffic. Performance stabilization means that a chosen workload's relevant measurements have become sufficiently consistent for a stated purpose. None implies the next automatically.

## 2. Tiers are choices, not a staircase

HotSpot initially can execute a method in the **interpreter** (level 0), which processes its bytecode. Its tiered just-in-time compilers can produce C1 code at levels 1, 2 or 3, with different profiling behavior, and more aggressively optimized C2 code at level 4. The policy uses invocation and loop activity, collected profiles, compiler availability and other state to choose useful transitions.

That is a menu of possible paths, not a required `0 → 1 → 2 → 3 → 4` sequence. A rarely used error handler may remain interpreted; a hot calculation might reach level 4; a method may be recompiled. There is no requirement for every method to reach C2 before a service can be measured well.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable tier progression diagram"><a href="/images/courses/jvm/jvm-tiered-warmup-progression.svg"><img src="/images/courses/jvm/jvm-tiered-warmup-progression.svg" alt="Interpreter level 0 branches toward possible C1 levels 1, 2 and 3 or remains interpreted; hot profiled paths may reach C2 level 4." width="1080" height="440" /></a><figcaption>Compilation levels describe possible execution choices for individual methods, not an application-wide progress meter.</figcaption></figure>

## 3. One endpoint can warm while another stays cold

Imagine `OrderService.findOrder()` serving thousands of searches per second while `generateInvoice()` is called once an hour. Search traffic gives HotSpot observations about its search path. It says almost nothing about the invoice path. The same distinction holds for a Search API and a Reporting API: warming Search does not pre-load all reporting classes, fill its caches, or compile its loops.

The unit of reasoning is therefore an **operation under an input distribution**, not simply a running JVM. Even within one endpoint, a small input and a large input may take distinct branches and allocation paths. If the performance objective covers both, the offered workload must cover both.

## 4. Profiles can become stale

Suppose `discount(Order)` has seen only `RegularDiscount` during warm-up. HotSpot may observe one receiver type and optimize a guarded fast path. Production then brings a mix of `RegularDiscount` and `PremiumDiscount`. The guard can fail; execution remains correct through a fallback, and HotSpot may deoptimize, collect a changed profile and compile a replacement. [Lesson 56](/courses/jvm/deoptimization-in-production) follows that recovery mechanism.

This does not mean every new type causes a dramatic pause, nor that a method permanently loses its optimized state. It means **warmth is conditional on what was observed**. A profile shift can restart part of the adaptation process even after yesterday's workload looked stable.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable workload profile shift diagram"><a href="/images/courses/jvm/jvm-workload-profile-shift.svg"><img src="/images/courses/jvm/jvm-workload-profile-shift.svg" alt="RegularDiscount-only traffic leads to a specialized path; a later RegularDiscount and PremiumDiscount mix can use fallback, deoptimization and recompilation." width="1080" height="440" /></a><figcaption>A representative input mix matters as much as request volume.</figcaption></figure>

## 5. Class and application work have their own clocks

JVM class **loading** obtains a type's definition; initialization can run its static initializer before first active use. A readiness check might touch health code but never touch a reporting serializer. The first report can still load that serializer and initialize its dependencies. These are runtime events, but they are not evidence that JIT compilation is the cause of a slow request.

Application caches, dependency-injection objects, database pools and TLS connections add separate timelines. A cache might become useful only after representative keys arrive; a connection pool may grow with concurrency. If p99 falls while compilation activity stays quiet, inspect these layers before changing compiler settings.

## 6. G1 adaptation is independent of JIT adaptation

Under G1, allocation rate and object survival influence young collection sizing. Occupancy and observed marking behavior influence when concurrent marking needs to begin; pause goals and remembered-set work affect collection choices. Those policies use history from the actual allocation pattern. A search-heavy warm-up may allocate differently from later reports.

JIT and GC can influence each other: optimized code can change allocation, and compiler threads share CPU with GC workers. Yet their stabilization is independent. Important methods may already run in C2 while heap occupancy or collection cadence still changes. Conversely, G1 may show a repeatable pattern while a rarely exercised method remains cold. A periodic batch may prevent any single steady allocation regime.

## 7. A useful definition of steady state

For a specified performance experiment, call an interval **steady enough** when the offered workload is stable and representative, and the relevant outcomes have no material warm-up trend across repeated observation windows. This is a measurement decision with a tolerance, not a JVM state bit. HotSpot exposes no universal `isWarmedUp()` and continues to adapt throughout the process lifetime.

Look jointly at completed throughput, p99 and p99.9 latency, error rate, CPU, compilation activity and queues, deoptimization, and GC. Select tolerances from the service objective before looking at the result. An empty queue does not prove all important code reached C2; stable CPU does not prove stable tail latency. The experiment can be valid without either condition.

<mark>Steady state is an operational judgment under a stated workload, not a promise that the JVM has stopped changing.</mark>

## 8. Why a 30-second timer is weak evidence

`30 seconds warm-up; five minutes measurement` assumes that clock time predicts work completed. Eight CPUs can process compiler tasks differently from a container with a one-CPU quota, as Lesson 57 showed. At 10 requests/s, thirty seconds presents roughly 300 requests; at 2,000 requests/s, it presents roughly 60,000. Even those counts say little if one test sends only Search while another sends Search, Payment and Reporting.

A fixed delay can be useful as a minimum operational guard. It cannot establish that the paths whose latency matters have been exercised. Delaying readiness without sending useful traffic only postpones requests; it does not warm the relevant code or application caches.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable fixed versus measured warm-up diagram"><a href="/images/courses/jvm/jvm-fixed-vs-adaptive-warmup.svg"><img src="/images/courses/jvm/jvm-fixed-vs-adaptive-warmup.svg" alt="Fixed 30-second cutoff ignores different CPU budgets and request rates; a metric-based gate observes repeated representative windows." width="1080" height="440" /></a><figcaption>Use a clock to organize windows; use workload and measured trends to decide whether those windows are comparable.</figcaption></figure>

## 9. Read a warm-up curve without inventing a universal threshold

Imagine equal 30-second observation windows under an offered workload that the service can sustain:

| Elapsed window | Completed throughput | p99 latency | Compilation activity |
|---|---:|---:|---|
| 0–30 s | 4,000 req/s | 120 ms | High |
| 30–60 s | 6,500 req/s | 75 ms | Moderate |
| 60–90 s | 7,800 req/s | 42 ms | Low |
| 90–120 s | 7,850 req/s | 41 ms | Low |
| 120–150 s | 7,830 req/s | 43 ms | Low |

These values are **illustrative**, not a result from the lab below. The last three windows suggest a plateau for this mix: completed throughput varies little, p99 has no continuing downward trend, and the initial compilation burst has subsided. A single flat window would not establish that. Repeat cold starts and compare the variation between runs.

Count requests and errors in each window. A p99 from a tiny sample is noisy, and a p99.9 needs still more observations. Save request histograms or raw latency samples: percentiles from separate windows cannot be averaged to obtain the pooled percentile. At a fixed offered load below capacity, completed throughput should be nearly fixed by the load generator, so it may not reveal efficiency gains; compare latency, CPU per request and saturation as well. At capacity, changing throughput is informative, but it can reflect errors or drops unless those are counted.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable performance windows chart"><a href="/images/courses/jvm/jvm-warmup-performance-windows.svg"><img src="/images/courses/jvm/jvm-warmup-performance-windows.svg" alt="Five illustrative 30-second windows show throughput rising 4000 to about 7800 requests per second while p99 falls 120 to about 42 milliseconds; final three windows are similar." width="1080" height="440" /></a><figcaption>A plateau is evidence to inspect, not a certificate of permanent warmth.</figcaption></figure>

## 10. Design representative observation windows

Fix the request mix, input sizes, arrival pattern, concurrency, dependency state and deployment resources across compared runs. Record the **offered** rate as well as completions, timeouts and errors. If the system has a daily reporting burst or periodic batch, either reproduce that cycle or state that the conclusion applies only to the non-batch period. A mixed workload can produce a stable overall mean while the less frequent operation's p99 remains unstable, so retain per-operation histograms.

Choose consecutive windows large enough to contain sufficient requests and relevant GC cycles. Compare trends and uncertainty over repeated clean starts, not merely absolute values in one run. Define an acceptable deviation for the actual service goal; a latency-sensitive service may need a stricter p99.9 criterion than a throughput experiment.

## 11. Start JFR with the process

Java Flight Recorder (JFR) can capture early runtime events if it starts with the JVM. For a disposable local process or an approved service instance:

```bash
java -XX:StartFlightRecording=name=warmup,settings=profile,filename=warmup.jfr,dumponexit=true -jar application.jar
```

Run the representative workload and stop the process normally. To inspect an ongoing run before exit, request a snapshot:

```bash
jcmd <pid> JFR.dump name=warmup filename=warmup-snapshot.jfr
jfr summary warmup-snapshot.jfr
jfr print --events jdk.Compilation,jdk.Deoptimization,jdk.CompilerQueueUtilization warmup-snapshot.jfr
```

Replace `<pid>` with the target Java process ID. Align event timestamps with request metrics. The exact event selection and thresholds depend on the recording configuration; recording a period does not ensure every short compilation appears.

## 12. Know what JDK 25 `profile.jfc` records

In tagged JDK 25 `profile.jfc`, `jdk.Compilation` is enabled with a **100 ms threshold**. `jdk.CompilerQueueUtilization` is enabled every **5 seconds**; `jdk.CompilerStatistics`, `jdk.Deoptimization`, `jdk.CodeCacheStatistics`, `jdk.CPULoad` and GC events are enabled. A brief compile may fall below the compilation threshold. <mark>No `jdk.Compilation` event does not mean no compilation happened.</mark>

Queue utilization is periodic, so a short transient can also fall between samples. Use JFR to correlate broad phases, then turn to compilation logs or targeted snapshots if a claim depends on a short event. Profile settings and event names here describe JDK 25 HotSpot configuration; check the effective `.jfc` when running a different build.

## 13. Add queue, Code Cache and log snapshots

While the process runs, take several snapshots, each timestamped against the same test clock:

```bash
jcmd <pid> Compiler.queue
jcmd <pid> Compiler.codecache
```

The first describes pending compilation work at that instant. The second describes compiled-code storage. Neither alone identifies a latency cause. For a controlled rerun, unified logging can add class-load, safepoint and GC timing:

```bash
java -Xlog:gc=info,safepoint=info,class+load=info:file=runtime.log:time,uptime,level,tags \
  -XX:StartFlightRecording=name=warmup,settings=profile,filename=warmup.jfr,dumponexit=true \
  -jar application.jar
```

Class-load logging can be voluminous. Keep logs bounded in a disposable investigation, and correlate timestamps with the load generator rather than inferring causality from a shared time window alone.

## 14. A bounded teaching lab

The following `WarmupLab.java` makes two paths visible. Search runs repeatedly; reporting first appears later. `volatile` prevents the final result from becoming wholly unobservable. The loops are intentionally nontrivial but their exact compilation and timing depend on the JDK, machine and optimization choices.

```java
public class WarmupLab {
    private static volatile long sink;

    private static long search(int seed) {
        long score = seed;
        for (int i = 0; i < 1_000_000; i++) {
            score = (score * 31 + i) ^ (score >>> 7);
            if ((score & 15) == 3) score += i * 17L;
        }
        return score;
    }

    private static long report(int seed) {
        long total = 0;
        for (int i = 1; i <= 600_000; i++) {
            long row = (long) (seed + i) * (i % 97 + 1);
            total += Long.rotateLeft(row, i & 31) ^ (row / (i % 19 + 1));
        }
        return total;
    }

    private static void timed(String label, java.util.function.IntToLongFunction work, int seed) {
        long start = System.nanoTime();
        sink = work.applyAsLong(seed);
        System.out.printf("%s: %.3f ms, result=%d%n",
                label, (System.nanoTime() - start) / 1_000_000.0, sink);
    }

    public static void main(String[] args) {
        for (int i = 0; i < 5; i++) timed("search " + (i + 1), WarmupLab::search, i + 1);
        timed("first report", WarmupLab::report, 7);
        timed("repeat report", WarmupLab::report, 8);
    }
}
```

Compile and run on a local JDK 25:

```bash
javac WarmupLab.java
java -XX:+PrintCompilation -XX:StartFlightRecording=name=warmup,settings=profile,filename=warmup.jfr,dumponexit=true WarmupLab
jfr summary warmup.jfr
```

Look for method names and compilation levels in `PrintCompilation`, and compare first versus repeated calls. A method can compile during an invocation, after it, or not visibly at all in such a short run. The reporting calls have different seeds, so their timing is not an isolated estimate of a compilation cost. This is a **teaching experiment**, not a scientific microbenchmark. Use repeated forks and a measurement harness for claims about method speed.

## 15. JMH measures a narrower question

The Java Microbenchmark Harness (JMH) separates `@Warmup` iterations from `@Measurement` iterations and can use `@Fork` to launch fresh JVM processes. That helps reveal per-method behavior and between-process variability. A warm-up setting in JMH is still a chosen duration or iteration count, so inspect whether the benchmark truly stabilizes. Its harness and isolation address a different question from a whole Spring Boot service with connection pools, caches, downstreams, routing and tail-latency objectives. Use both where their scopes fit.

## 16. Readiness during rolling deployments

Consider a mature pod beside a new pod. Both pass the same readiness probe. The new pod may still spend CPU loading classes, growing pools and compiling important methods, so its p99 can differ from the mature pod's under the same request mix. Replacing several pods together can expose that difference to a large share of traffic; a restrictive CPU quota can extend it.

Where safe, send representative warm-up requests that avoid irreversible side effects. Introduce production traffic gradually and compare new-pod versus mature-pod request histograms, CPU, compiler activity, errors and GC. Maintain enough capacity for compiler CPU and application initialization. A fixed readiness delay is no universal fix: without relevant requests it may warm nothing, and an excessively strict readiness gate can impede deployment or recovery.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable rolling deployment warm-up diagram"><a href="/images/courses/jvm/jvm-rolling-deployment-warmup.svg"><img src="/images/courses/jvm/jvm-rolling-deployment-warmup.svg" alt="A mature pod and a newly ready pod receive gradually shifted traffic; compare p99 while the new pod performs compiler, cache and connection work." width="1080" height="440" /></a><figcaption>Measure new and mature instances separately while traffic shifts.</figcaption></figure>

## 17. A case study: the new pod's p99 spikes

Suppose an eight-pod service replaces two pods. New pods report ready after four seconds, then their p99 is 120 ms for about a minute while mature pods stay near 40 ms. The initial hypothesis is warm-up, not a diagnosis. Partition the histograms by pod and operation. Check whether the new pods receive the same inputs and offered rate, whether errors or retries differ, and whether their CPU is throttled.

Now align JFR compilation and queue activity, `Compiler.queue` snapshots, Code Cache use, class-load and GC logs, cache misses and connection establishment with the latency windows. If compilation and throttling subside with p99, delayed optimization is plausible. If p99 falls when a database pool finishes opening while compilation remains quiet, the pool is a better lead. If only Reporting spikes after Search-only pretraffic, the warm-up mix is incomplete. Change one condition in a repeatable rollout experiment and compare several replacements.

## 18. Diagnose a second rise after stability

Suppose p99 was stable for ten minutes, then rises when Premium orders arrive. Inspect the per-operation input mix first. A changed receiver-type profile can trigger guard fallback, deoptimization and recompilation; a new code path can load classes; new allocations can change G1 behavior. This is why the term *steady state* always needs its workload qualifier. Earlier windows can remain valid measurements of the Regular-only workload even though they do not predict the mixed workload.

## 19. Trace the JDK 25 implementation

For the compiler path, read the fixed `jdk-25+36` OpenJDK sources: [`compilationPolicy.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilationPolicy.cpp) for level decisions and profiled transitions; [`compileBroker.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileBroker.cpp) for queued compilation work; [`codeCache.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/code/codeCache.cpp) for installed code; and [`deoptimization.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/deoptimization.cpp) for return from invalid optimized code. The [G1 source directory](https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share/gc/g1) contains the collector mechanisms behind its separate adaptation path.

Trace **profile → policy → compilation task → installed code → possible deoptimization**, then trace **allocation and survival → G1 observations → collection choices**. These are HotSpot implementation paths, not requirements of the Java language specification. A source path explains what can happen; measured events establish what happened in your run.

## 20. Eight reasoning checks

<details class="lesson-check"><summary>Spring Boot says “Started in 4.2s.” Is p99 stable?</summary><p>No conclusion follows. Startup reports framework initialization; test representative traffic and observe repeated latency windows.</p></details>
<details class="lesson-check"><summary>Search is warm, but Reporting has never run. Is the service globally warm?</summary><p>No. Reporting may load classes, fill caches, allocate differently and produce new compilation work on first use.</p></details>
<details class="lesson-check"><summary>Does every method need level 4 C2 code before measurement?</summary><p>No. A rarely used or inexpensive method can remain interpreted without harming the stated performance objective.</p></details>
<details class="lesson-check"><summary>A 30-second warm-up worked on eight CPUs. Will it work with one CPU quota?</summary><p>It is unproven. Compiler and request work share a smaller budget; compare measured windows in the target deployment.</p></details>
<details class="lesson-check"><summary>Can three similar p99 windows be averaged into a combined p99?</summary><p>No. Pool raw samples or merge compatible histograms; an arithmetic mean of percentiles is not the pooled percentile.</p></details>
<details class="lesson-check"><summary>JFR shows no jdk.Compilation event. Was there no compilation?</summary><p>No. JDK 25 profile.jfc filters compilation events shorter than 100 ms; check the recording settings and other evidence.</p></details>
<details class="lesson-check"><summary>Compilation is quiet, but GC behavior continues to change. Is that impossible?</summary><p>No. G1 adapts from allocation, survival and occupancy observations independently of JIT progression.</p></details>
<details class="lesson-check"><summary>A new ready pod has worse p99 than a mature pod. Should readiness simply wait a fixed minute?</summary><p>First compare workload, CPU, caches, connections, compiler and GC evidence. A timer without representative work may only defer the difference.</p></details>

## 21. The integrated mental model

The application starts and declares readiness by its own criteria. Actual requests then select classes, branches, receiver types, allocations, caches and external connections. HotSpot observes invocation and branch behavior, may compile through C1 or C2, and may replace assumptions when the profile changes. G1 observes a separate allocation history and adapts collection choices. Compiler, GC and request threads all spend the available CPU budget. The Code Cache stores compiled results; application metrics show whether those changes matter to users.

Under a stable, representative offered workload, compare repeated windows of per-operation throughput, latency distributions, errors and resource behavior. Call the period steady enough when those outcomes meet the experiment's predefined tolerance across runs. Then state which workload, deployment and time period the conclusion covers. A new traffic mix can reopen the question.

## 22. Where the next byte goes

Warm-up repeats some work on every fresh process. **Next preview — Lesson 59: Class Data Sharing and AOT Caches — Reducing Repeated JVM Startup Work.** It will examine which class and profile work JDK 25 can reuse across starts. Lesson 59 is planned; it has no route yet.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #58 and the reviewed Lesson 58 draft. The service timelines, performance table, case studies and diagrams are illustrative. The Java lab is a teaching experiment, not a benchmark. Its source compiled and ran on local OpenJDK 25.0.2; a short profile JFR recording was created and read with <code>jfr summary</code>. The printed timings are not reproduced here because they are machine and run dependent. The service-level <code>jcmd</code> and logging commands were not run against an application. Compiler tiers, JFR event settings and G1 behavior describe JDK 25 HotSpot rather than a Java language guarantee. Readiness behavior is application and deployment specific.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilationPolicy.cpp">OpenJDK jdk-25+36 compilationPolicy.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileBroker.cpp">OpenJDK jdk-25+36 compileBroker.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/code/codeCache.cpp">OpenJDK jdk-25+36 codeCache.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/runtime/deoptimization.cpp">OpenJDK jdk-25+36 deoptimization.cpp</a></li><li><a href="https://github.com/openjdk/jdk/tree/jdk-25%2B36/src/hotspot/share/gc/g1">OpenJDK jdk-25+36 G1 sources</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.jfr/share/conf/jfr/profile.jfc">OpenJDK jdk-25+36 profile.jfc</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd reference</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html">JDK 25 jfr reference</a></li><li><a href="https://openjdk.org/projects/code-tools/jmh/">OpenJDK JMH project</a></li></ul></details>
