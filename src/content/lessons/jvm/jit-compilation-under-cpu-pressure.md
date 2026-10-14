---
title: JIT compilation under CPU pressure
summary: Trace HotSpot's C1 and C2 work queues, CPU competition, container throttling and Code Cache limits to explain delayed warm-up and production latency.
course: jvm
lessonSlug: jit-compilation-under-cpu-pressure
module: HotSpot Internals
order: 570
sourceByte: byte-057
draft: false
prerequisites:
  - deoptimization-in-production
jdk: JDK 25 · HotSpot tiered compilation and JFR
---

In [Lesson 56](/courses/jvm/deoptimization-in-production), an invalidated optimization could return a hot method to less optimized execution and create new compilation work. Now imagine many methods becoming hot at once while a Kubernetes container has only one CPU of quota. What happens when HotSpot can identify useful optimizations faster than it can compile them?

Consider a Spring Boot service whose p99 latency is **180 ms during its first minute and 35 ms after warm-up**. Those numbers are illustrative, not measurements. Class loading, connections, caches and framework initialization may all contribute. This lesson follows the compilation part of the question, from profiling to installed machine code, then shows how to test whether it matters in a real incident.

## 1. Compilation spends CPU to save CPU

HotSpot begins with executable bytecode, runs methods in the interpreter, and gathers profiles. Its just-in-time (JIT) compilers turn selected methods into native machine code. C1 can compile relatively quickly and collect more profiles; C2 spends more work on optimizations such as inlining, loop transformations and escape analysis. The resulting compiled method, or **nmethod**, lives in the Code Cache.

Compiler threads must analyze bytecode, construct intermediate representations and generate instructions. They share processor capacity with request threads, garbage collection workers and other runtime services. <mark>JIT compilation spends CPU now to make later execution cheaper.</mark> Whether the investment pays back within a short lived workload depends on when optimized code becomes available.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable CPU investment diagram"><a href="/images/courses/jvm/jit-compilation-cpu-investment.svg"><img src="/images/courses/jvm/jit-compilation-cpu-investment.svg" alt="Compiler and application work share CPU during warm-up; installed optimized code can reduce application CPU per request later." width="1080" height="420" /></a><figcaption>Compilation consumes part of the current CPU budget to reduce the cost of future calls; the payoff is workload dependent.</figcaption></figure>

## 2. Background compilation keeps calls moving

When `calculatePrice()` becomes hot, an application thread normally requests compilation and keeps executing an existing interpreted or compiled version. A compiler thread works separately; a later invocation can use the installed nmethod. JDK 25 HotSpot enables `-XX:+BackgroundCompilation` by default. This asynchronous path avoids making the request that crosses a compilation threshold wait for C2 to finish.

`-Xbatch` requests synchronous compilation and can make controlled experiments easier to interpret. It also introduces waits at compilation points, so it is not a general production latency fix. Asynchronous compilation does not mean compilation is free: compiler threads still compete for CPU.

## 3. Policy, broker and tasks have different jobs

Runtime profiles inform the compilation policy, which decides whether to request compilation and at what level. `CompileBroker` coordinates the work. A `CompileTask` represents a particular request; compiler threads take tasks from separate C1 and C2 queues when those compilers are enabled. After generating an nmethod, HotSpot installs it in the Code Cache.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable compiler queue architecture"><a href="/images/courses/jvm/jit-compiler-queues.svg"><img src="/images/courses/jvm/jit-compiler-queues.svg" alt="Runtime profiles flow through policy and CompileBroker into separate C1 and C2 task queues, compiler threads, nmethods and Code Cache." width="1080" height="500" /></a><figcaption>Policy chooses useful work; the broker and its queues coordinate when compiler threads can deliver it.</figcaption></figure>

The separation matters diagnostically. A sensible policy decision can still wait behind other tasks when compiler capacity is constrained. Conversely, queue activity alone does not prove that the policy is making bad choices.

## 4. A queue is pending optimization work

During startup, requests for compilation can arrive faster than compiler threads complete them. A simplified queue grows if 30 tasks per second arrive while the compilers complete 10. Those figures are hypothetical. Real HotSpot queues are not simple permanent FIFO lists: policy can adjust priorities, re-evaluate tasks and discard work that is no longer useful.

A transient queue during startup is normal. A repeatedly populated queue coupled with poor throughput, delayed warm-up and high latency after the service should have stabilized is a reason to investigate. One snapshot cannot tell whether a backlog is growing, shrinking or merely passing through.

## 5. The existing execution tier keeps running

HotSpot's tiered levels are 0 for the interpreter, 1 and 2 for C1 variants with limited profiling, 3 for C1 with full profiling, and 4 for C2. A method need not visit every level in order. Suppose `calculatePrice()` currently runs at level 3 and a level 4 C2 request is queued. Calls continue through the existing C1 nmethod while C2 waits and compiles. The application is correct and responsive, but it may spend more CPU per call than it would with a suitable level 4 version.

This is a delay in *availability* of an optimization. It is different from an exception, a GC pause or a guarantee that C2 will speed up this specific method.

## 6. Kubernetes defines a shared CPU budget

Consider this container configuration:

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1"
```

The request informs scheduling and resource allocation; the limit can enforce approximately one core equivalent of CPU time. Application threads, C1 and C2 compiler threads, GC workers and framework initialization share that budget even if the node has many more cores. When compiler work rises during warm-up, CPU available for serving requests can fall.

## 7. Runnable contention and quota throttling differ

**CPU contention** means runnable threads compete for processor time. An application thread can wait while a compiler thread runs even when the cgroup never exhausts a quota. **Quota throttling** occurs when a cgroup uses its allowed CPU time within a scheduling period and Linux prevents further execution until quota is replenished. Both can delay a compilation's wall-clock completion and request p99; only the second specifically demonstrates quota enforcement.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable contention and throttling comparison"><a href="/images/courses/jvm/jit-cpu-contention-vs-throttling.svg"><img src="/images/courses/jvm/jit-cpu-contention-vs-throttling.svg" alt="Top lane shows application and compiler threads taking turns on a busy CPU; bottom lane shows a cgroup consuming its quota then waiting for the next period." width="1080" height="470" /></a><figcaption>Thread competition can delay work before any quota is exhausted; throttling adds an enforced wait after the group spends its allowance.</figcaption></figure>

## 8. Delayed optimization can reinforce CPU pressure

More traffic heats more methods and creates compile requests. If compiler threads get less CPU, their tasks take longer in wall-clock time. Hot methods continue in the interpreter or C1, potentially costing more CPU per request. That can leave less headroom for compilation and prolong warm-up.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable delayed optimization feedback loop"><a href="/images/courses/jvm/jit-delayed-optimization-feedback.svg"><img src="/images/courses/jvm/jit-delayed-optimization-feedback.svg" alt="CPU pressure slows compiler progress; queued optimization leaves hot methods in lower tiers; extra execution CPU can sustain pressure." width="1080" height="440" /></a><figcaption>A possible reinforcing loop, not an inevitable outcome. Its strength depends on workload, tiers, quota and existing optimized code.</figcaption></figure>

<mark>CPU pressure can delay optimized code and extend time spent in less efficient execution tiers.</mark> Measure before assigning this loop to a particular service: a sufficiently warmed application or a workload with little compilation demand may show no material effect.

## 9. Compiler thread counts are ergonomic

`-XX:CICompilerCount` controls the configured compiler thread count. By default, JDK 25 chooses it ergonomically using the runtime's processor view and compiler configuration. `-XX:+UseDynamicNumberOfCompilerThreads` permits the active population to change with demand; a configured maximum does not imply all threads remain active. The broker's `CompileBroker::can_remove()` path helps govern retirement of compiler threads.

More compiler threads can process independent tasks, but each needs CPU and memory. Under a strict one CPU limit, raising the count may add scheduling contention without increasing useful throughput. Do not treat thread count as a tuning target until measurements show a persistent queue and actual spare CPU.

## 10. Container processor detection shapes ergonomics

HotSpot detects container resource constraints when choosing defaults. `-XX:ActiveProcessorCount=2` overrides the processor count the JVM uses for ergonomic decisions; it can affect compiler and GC thread choices. It **does not alter the Linux kernel's CPU quota**. Setting it to two inside a one CPU limited container cannot create a second core of allowed execution.

This distinction is essential when comparing JVM flags with Kubernetes resource settings. The process's internal capacity plan and the kernel's enforced budget are separate layers.

## 11. The Code Cache stores the result

Compilation is useful only if generated code can be installed. HotSpot stores nmethods and other generated code in native Code Cache memory. A typical tiered JDK 25 configuration reserves about 240 MiB by default, subject to platform, flags and ergonomics. With segmented Code Cache enabled, a non-method heap stores runtime generated code, a profiled method heap holds code with profiling, and a non-profiled method heap holds more fully optimized code.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable segmented Code Cache"><a href="/images/courses/jvm/jit-segmented-code-cache.svg"><img src="/images/courses/jvm/jit-segmented-code-cache.svg" alt="The reserved Code Cache contains separate non-method, profiled-method and non-profiled-method regions; C1 and C2 code consume relevant method regions." width="1080" height="420" /></a><figcaption>The heaps have different roles and capacities; check actual flags and occupancy rather than assuming every process has the same reservation.</figcaption></figure>

## 12. Full code storage and a busy compiler are separate failures

With a CPU backlog, tasks wait for compiler time. With Code Cache exhaustion or an applicable code heap too full, HotSpot may suspend compilation because it cannot install more code normally. Adding compiler threads will not create storage. `jcmd <pid> Compiler.codecache` and Code Cache events help distinguish storage pressure from scheduling delay.

Deoptimization from Lesson 56 can add recompilation demand and Code Cache churn: old nmethods may become non-entrant while replacement code is produced. Repeated churn can combine with CPU pressure, but a single deoptimization does not imply Code Cache exhaustion.

## 13. Begin with actual flags

Run these against JDK 25 and the target process. The first command prints defaults and ergonomic values for that `java` invocation; the second shows the running process's flags.

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'CICompilerCount|UseDynamicNumberOfCompilerThreads|TieredCompilation|ReservedCodeCacheSize|BackgroundCompilation'
jcmd <pid> VM.flags
```

Replace `<pid>` with the Java process ID. Interpret `ReservedCodeCacheSize` as a reservation, not a measurement of code currently used. Compare the process flags with its container CPU configuration before proposing changes.

## 14. Read compilation levels in context

For a controlled local run, launch with:

```bash
java -XX:+PrintCompilation -jar app.jar
```

The log's level column can show level 3 C1 with full profiling and level 4 C2, among other levels. A method can appear more than once because it is recompiled, compiled at another tier, or invalidated. The log tells you *what happened to compilation*, not how much each line changed p99 latency. A missing level 4 line for a method does not by itself diagnose CPU pressure.

## 15. Inspect a live queue carefully

```bash
jcmd <pid> Compiler.queue
```

This reports a point-in-time view of pending compiler work. Record several snapshots with timestamps during startup and steady traffic, and correlate them with workload and CPU observations. One empty snapshot does not prove there was no earlier backlog; one populated snapshot does not establish a persistent capacity problem.

## 16. Inspect code storage separately

```bash
jcmd <pid> Compiler.codecache
```

Look at each heap's size and used space, not just total reservation. If compilation is suspended or Code Cache is full, investigate code storage and code lifetime. If storage has headroom while queues remain populated and compiler threads are CPU constrained, focus on compilation capacity and scheduling. Keep deoptimization and recompilation activity in the picture when code usage changes rapidly.

## 17. Capture JFR during the relevant window

Java Flight Recorder (JFR) can connect compilation events to the same two minute window as latency and CPU metrics:

```bash
jcmd <pid> JFR.start name=jit-pressure settings=profile duration=120s filename=/tmp/jit-pressure.jfr
jfr summary /tmp/jit-pressure.jfr
jfr print --events jdk.Compilation,jdk.CompilerStatistics,jdk.CodeCacheStatistics,jdk.CodeCacheFull /tmp/jit-pressure.jfr
```

Use the running JDK 25 tools and verify the recording file exists after the duration. The JDK 25 `profile.jfc` configuration gives `jdk.Compilation` a 100 ms default threshold and `jdk.CompilerPhase` a 10 s threshold. Missing events therefore **do not prove compilation did not occur**. Event availability and event counts also depend on the recording configuration. Use `-XX:+PrintCompilation`, queue snapshots and process metrics alongside JFR.

## 18. Read cgroup CPU evidence

On Linux with cgroup v2, inspect the target container's cgroup files:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
```

`cpu.max` reports quota and period, or `max` when there is no quota. `cpu.stat` includes `usage_usec`, `nr_periods`, `nr_throttled` and `throttled_usec` when applicable. Compare deltas over the incident window. A rising `nr_throttled` shows throttled periods, but does not by itself quantify request latency or prove compiler threads caused the throttling. Match cgroup evidence to per-thread CPU, compiler activity, traffic and p99 timing.

## 19. Observe the right layers together

JVM flags describe capacity choices; compilation logs and JFR describe work performed; `Compiler.queue` shows pending work now; `Compiler.codecache` describes storage; cgroup counters describe enforced CPU limits; request metrics describe user impact. <mark>No single compiler metric establishes that JIT work caused a latency regression.</mark>

An effective incident timeline aligns these observations by time. If compiler activity falls as p99 improves while throttling also falls, JIT is plausible. If p99 improves after a slow external connection warms while compiler metrics remain stable, look elsewhere.

## 20. Compare cold and warm behavior fairly

Design a controlled comparison of a four CPU deployment and a one CPU deployment. Keep JDK build, application image, heap, workload, dependencies, startup route and request mix the same. Run repeated cold starts, measure traffic onset and readiness, and compare p50/p99, throughput, compiler activity, queue snapshots, Code Cache and cgroup counters. Warm-up curves can vary across runs, so avoid a one-run conclusion.

Readiness means the application-defined probe passed. It does not mean all hot methods are optimally compiled. Cold-start cost can also come from class loading, framework work, dependency connections and caches. A 180 ms first-minute p99 versus a 35 ms later p99 is a useful illustrative pattern, never a causal diagnosis by itself.

## 21. A production investigation sequence

First define the latency window and compare it to request load, throughput and CPU. Then inspect flags and container quota, collect repeated queue and Code Cache snapshots, capture JFR in the affected window, and compare cgroup deltas. If evidence points to compiler CPU, reproduce with a controlled CPU budget comparison. If Code Cache is full, investigate storage and nmethod churn. If neither fits, examine initialization, GC, external dependencies and application work.

<aside class="lesson-callout" data-kind="production" aria-label="Production note"><p class="callout-label">Production note</p><p>Change one resource or JVM setting at a time in a repeatable workload. Raising <code>CICompilerCount</code>, forcing <code>-Xbatch</code>, or changing <code>ActiveProcessorCount</code> has no blanket performance benefit under a fixed CPU quota.</p></aside>

## 22. How deoptimization adds repeat work

An uncommon trap or invalidation may send execution back to a valid lower tier, collect new profiles and request replacement code. When this happens repeatedly, compiler CPU and Code Cache turnover can rise together. Connect an observed event stream to compile levels, method identity, code storage and latency before attributing a regression to deoptimization. The causal chain is plausible; its frequency and impact must be measured.

## 23. Trace the path in JDK 25 source

Read the tagged OpenJDK `jdk-25+36` sources in this order. Start with [`compilationPolicy.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilationPolicy.cpp) to see policy decisions. Follow requests into [`compileBroker.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileBroker.cpp), including separate queues and `CompileBroker::can_remove()`. Inspect [`compileTask.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileTask.cpp) for task representation, [`compilerDefinitions.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilerDefinitions.cpp) for definitions and defaults, and [`codeCache.cpp`](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/code/codeCache.cpp) for generated-code storage.

The path to trace is **profile → policy → broker → C1/C2 queue → compiler thread → nmethod → Code Cache**. This is an implementation path in JDK 25 HotSpot, not a Java language contract.

## 24. Reasoning checkpoints

<details class="lesson-check"><summary>A C2 task waits while a method runs at level 3. Do requests stop?</summary><p>No. Calls can continue through the existing C1 version while background C2 compilation waits.</p></details>
<details class="lesson-check"><summary>One Compiler.queue snapshot is empty. Was warm-up free of backlog?</summary><p>No. It describes one instant; earlier tasks may already have completed. Sample across the relevant interval.</p></details>
<details class="lesson-check"><summary>Compiler threads use CPU but nr_throttled stays flat. Can requests still slow?</summary><p>Yes. Runnable threads can contend for processor time without exhausting a cgroup quota.</p></details>
<details class="lesson-check"><summary>Would ActiveProcessorCount=2 raise a one CPU Kubernetes limit?</summary><p>No. It influences JVM ergonomic decisions, not the kernel quota in cpu.max.</p></details>
<details class="lesson-check"><summary>Will doubling CICompilerCount necessarily shorten warm-up under a one CPU limit?</summary><p>No. Extra compiler threads can compete for the same constrained CPU and may increase scheduling costs.</p></details>
<details class="lesson-check"><summary>JFR has no jdk.Compilation events. Did no compilation occur?</summary><p>No. The JDK 25 profile recording's default threshold filters short events; confirm with configuration, logs and other observations.</p></details>
<details class="lesson-check"><summary>Compilation is suspended and code heaps are full. Should you first add compiler threads?</summary><p>No. Inspect Code Cache capacity and code lifetime; more compiler CPU does not add code storage.</p></details>

## 25. The complete runtime model

Application calls produce profiles. Policy selects useful compilation tasks. The broker queues them for C1 or C2 compiler threads. Those threads need CPU time shared with requests and GC, and a successful nmethod needs Code Cache space. Until it is installed, existing interpreted or compiled execution continues. Container quotas can constrain every stage's timing, while deoptimization can create renewed demand. The outcome appears in throughput and latency only after the optimized code is used enough to repay its compilation cost.

<figure class="gc-log-figure jit-figure" role="region" tabindex="0" aria-label="Scrollable complete JIT runtime model"><a href="/images/courses/jvm/jit-complete-runtime-model.svg"><img src="/images/courses/jvm/jit-complete-runtime-model.svg" alt="Profiles create compilation tasks, compiler threads spend shared CPU, nmethods require Code Cache space, and later requests use installed code." width="1080" height="440" /></a><figcaption>The full path joins scheduling, CPU budget and code storage; each layer supplies a different diagnostic signal.</figcaption></figure>

## 26. Carry this into warm-up analysis

JIT compilation is a timed investment. A queue indicates pending work, a CPU limit can delay that work, and a full Code Cache can prevent its result from being installed. None of those observations alone proves the source of an application's slow start. Correlate them with the workload and user latency, and distinguish transient startup activity from sustained capacity pressure.

**Next — [Lesson 58: JVM warm-up vs. steady state](/courses/jvm/jvm-warmup-vs-steady-state).** We combine class loading, tiered compilation, deoptimization, GC, initialization and caching to ask when an application has reached a representative steady state.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on Daily JVM Byte #57 and its approved technical review. The service scenario, queue rates, latency figures and diagrams are illustrative; the flag-inspection command was run locally on OpenJDK 25.0.2 (BackgroundCompilation and dynamic compiler threads true, CICompilerCount 4, tiered compilation true, Code Cache reservation 240 MiB). The process-specific commands were not run against a production service. Compiler policy, queue behavior, defaults and Code Cache layout describe JDK 25 HotSpot rather than a Java language guarantee. Container observations describe Linux cgroup v2 and depend on the actual deployment.</p><ul><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileBroker.cpp">OpenJDK jdk-25+36 compileBroker.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compileTask.cpp">OpenJDK jdk-25+36 compileTask.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilationPolicy.cpp">OpenJDK jdk-25+36 compilationPolicy.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/compiler/compilerDefinitions.cpp">OpenJDK jdk-25+36 compilerDefinitions.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/hotspot/share/code/codeCache.cpp">OpenJDK jdk-25+36 codeCache.cpp</a></li><li><a href="https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.jfr/share/conf/jfr/profile.jfc">OpenJDK jdk-25+36 profile.jfc</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java launcher options</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html">JDK 25 jcmd reference</a></li><li><a href="https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html">Linux cgroup v2 CPU documentation</a></li></ul></details>
