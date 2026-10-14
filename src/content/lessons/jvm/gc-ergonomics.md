---
title: GC ergonomics — how HotSpot makes runtime decisions
summary: Follow G1's feedback loop as it sizes young collections, starts marking and chooses workers under changing workload pressure.
course: jvm
lessonSlug: gc-ergonomics
module: HotSpot Internals
order: 510
sourceByte: byte-051
draft: true
prerequisites:
  - measuring-gc-overhead
jdk: JDK 25 · G1 ergonomics
---

[Lesson 50](/courses/jvm/measuring-gc-overhead) gave us a way to measure collector cost. Measurements change when allocation rate, survival, CPU capacity and heap headroom change. HotSpot's **ergonomics** are its choices of initial settings and its later adaptation to those observations. This lesson follows G1, the Garbage-First collector, as a concrete JDK 25 example.

Picture two services with the same 4 GiB maximum heap. A gateway creates many short-lived request objects and retains little data. A session service allocates at a similar rate but keeps a much larger live set. A single fixed young-region count and marking threshold would face different evacuation and old-generation growth in these two workloads. G1 tries to adjust decisions using recent evidence.

| Workload property | Request gateway | Session service |
|---|---|---|
| Allocation | Rapid bursts of temporary objects | Similar rate, with more retained objects |
| Young survival | Usually low | Often higher |
| Old occupancy trend | Relatively stable after warmup | Can rise as sessions accumulate |
| Main prediction risk | A burst changes pause frequency | Copying cost and marking runway grow |

These are contrasting **hypothetical** profiles, not a claim that all gateways or session services behave this way. The useful variable is object survival, not the business label. If the gateway starts retaining request objects accidentally, its collector behavior can begin to resemble the second column.

## Startup choices and runtime choices

At startup, HotSpot considers available memory and processors, the chosen collector, explicit flags, and container limits when supported. It selects values such as a maximum heap when `-Xmx` is absent, a G1 region size, and GC worker maxima. Later, G1 uses pause histories, copied bytes, survivor behavior and old-generation growth to choose young collection size, old regions for mixed collections, when to begin marking and how many workers to activate for a pause.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable ergonomics feedback loop"><a href="/images/courses/jvm/gc-ergonomics-feedback-loop.svg" aria-label="Open ergonomics loop diagram"><img src="/images/courses/jvm/gc-ergonomics-feedback-loop.svg" alt="Workload allocation and survival feed observations of pause time and old growth; G1 predicts next costs, chooses young size, collection set, IHOP and workers, then observes the next cycle." width="1080" height="510" /></a><figcaption>Ergonomics is a feedback loop: observations inform predictions, which change later collection decisions.</figcaption></figure>

The loop is imperfect. An abrupt workload surge can outrun a policy trained on earlier conditions. G1 may need the failure and recovery paths from [Lesson 46](/courses/jvm/g1-failure-recovery). <mark>Adaptive policy reacts to measured history; it cannot promise the next pause or prevent every allocation failure.</mark>

## Young sizing follows a pause goal

G1's JDK 25 default `-XX:MaxGCPauseMillis=200` is a **soft goal**, not a deadline or a guarantee that every pause ends within 200 ms. G1 predicts work in the next young evacuation and tries to choose a young size that fits the goal. A larger young area can hold allocations longer, so young collections may be less frequent. But more regions, roots and surviving objects can make each evacuation more expensive. A smaller young area usually collects sooner and more often while reducing the work of an individual pause.

This **illustrative** prediction table is a thought experiment, not G1 output:

| Candidate young size | Predicted pause |
|---:|---:|
| 256 MiB | 35 ms |
| 512 MiB | 70 ms |
| 1 GiB | 130 ms |
| 2 GiB | 240 ms |

For a 200 ms goal, the largest row would exceed the predicted target. G1 does not literally select from this table; its model uses recent copying and remembered-reference costs, region counts, survivor behavior and other phase estimates. If survival suddenly rises, a previously affordable young size can produce a longer pause. A pause target is a policy input, not a measurement of achieved latency.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable young-size tradeoff"><a href="/images/courses/jvm/g1-young-sizing-tradeoff.svg" aria-label="Open young sizing diagram"><img src="/images/courses/jvm/g1-young-sizing-tradeoff.svg" alt="Small young size produces more frequent, usually shorter evacuations; large young size permits longer allocation intervals but can require more copying and longer pauses, with a soft pause-goal line." width="1080" height="470" /></a><figcaption>Frequency and pause duration move in opposite directions only as a tendency; the amount of live data and remembered work can change both.</figcaption></figure>

This is why pinning `-Xmn1g` is usually a poor first response to a G1 pause problem. A fixed young-generation size constrains an adaptation G1 needs to meet its pause goal. Inspect evidence before setting bounds or overriding defaults. Oracle's [JDK 25 G1 guide](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html) describes the goal and the young-size predictions.

## Mixed collection selection is a cost decision

After concurrent marking, G1 knows which old regions have reclaimable space. A **collection set (CSet)** is the set of regions selected for one evacuation pause. Young regions must be collected in a young or mixed pause; a mixed pause can add old regions. A region with a high garbage fraction looks attractive, but copying its live objects and processing incoming references still takes time. G1 weighs predicted live evacuation and remembered-set processing against expected reclamation, then chooses old candidates within the available pause budget. The highest-garbage region alone does not determine a complete CSet.

For the session service, more surviving objects can make an old region expensive to evacuate even when it will reclaim space. For the gateway, low survival can make reclamation cheaper. The pause target thus influences which old garbage is recovered now and which remains for later cycles.

Imagine two old regions of equal size. Region A has 70% reclaimable space but many live references to copy and many incoming cards to process. Region B has 55% reclaimable space and relatively little live or remembered work. The most profitable choice inside one pause can be B even though A has more garbage. These percentages and costs are illustrative; G1 evaluates a larger candidate set using its own estimates. If the chosen set exceeds the model's predicted cost because live data changed, the observed pause can miss its goal, and that result informs a later choice.

## Adaptive IHOP protects marking headroom

G1 must start concurrent marking early enough that it can identify old garbage before old occupancy consumes the available headroom. **Initiating Heap Occupancy Percent (IHOP)** is the threshold for starting that work. With `-XX:+G1UseAdaptiveIHOP` enabled by default, HotSpot estimates how long marking and the path to mixed reclamation will take and how quickly old occupancy will grow. A simple intuition is `200 MiB/s × 8 s = 1.6 GiB`: at that growth rate, an eight-second delay needs about 1.6 GiB of runway, plus safety margin. This is an illustrative headroom calculation, not G1's exact formula.

The default `-XX:InitiatingHeapOccupancyPercent=45` seeds the early phase before enough adaptive data is available. <mark>With adaptive IHOP, 45% is not a permanent fixed trigger after G1 has learned from the workload.</mark> A spike in retained allocation can invalidate yesterday's growth estimate; marking may start too late, and pressure can lead to expensive recovery. A much earlier start can consume extra concurrent CPU. G1 continually balances those risks.

<figure class="gc-log-figure" role="region" tabindex="0" aria-label="Scrollable marking headroom timeline"><a href="/images/courses/jvm/g1-adaptive-ihop-prediction.svg" aria-label="Open IHOP prediction diagram"><img src="/images/courses/jvm/g1-adaptive-ihop-prediction.svg" alt="Old occupancy rises toward heap headroom while concurrent marking takes time; the adaptive start point moves earlier when predicted growth or marking duration increases." width="1080" height="550" /></a><figcaption>The threshold is a timing decision about growth and available runway, not just one fixed occupancy percentage.</figcaption></figure>

## Worker maxima are not always active workers

`ParallelGCThreads` limits workers for parallel pause tasks; `ConcGCThreads` limits concurrent marking workers. G1's ergonomic concurrent maximum is approximately one quarter of the parallel maximum, subject to rounding and constraints. The workers actually active in a particular phase can be fewer than the configured maximum. Extra workers do not always shorten a tiny pause because coordination and available work matter.

JDK 25 HotSpot is container aware on supported Linux configurations. A CPU quota can affect the processor count HotSpot observes and therefore ergonomic worker sizing. `-XX:ActiveProcessorCount=4` overrides HotSpot's processor-count view for such decisions; <mark>it does not change the kernel's CPU quota</mark>. If the quota allows two cores, configuring four active processors cannot grant two more cores. Distinguish a policy misprediction from genuine CPU starvation before changing thread flags.

## Observe the feedback loop yourself

On a JDK 25 installation, inspect the flags and their origins before tuning. The values depend on machine and container context:

```bash
java -XX:+UseG1GC -XX:+PrintFlagsFinal -version 2>&1 \
  | grep -E 'MaxGCPauseMillis|G1UseAdaptiveIHOP|InitiatingHeapOccupancyPercent|ParallelGCThreads|ConcGCThreads|ActiveProcessorCount'
```

For a **bounded, non-production** lab application, turn on decision and heap logging:

```bash
java -XX:+UseG1GC -Xms512m -Xmx512m \
  -Xlog:gc+ergo=debug,gc+ergo+cset=debug,gc+heap=info \
  -jar lab.jar
```

If the JDK accepts it, add `-Xlog:gc+ihop=debug` for IHOP decisions; check available tags with `java -Xlog:help`. In phase A, repeatedly create short-lived objects at a controlled rate. In phase B, retain a bounded set of objects in a list while keeping allocation similar. Compare young-region counts, copied/surviving occupancy, predicted pause work, old occupancy, marking starts and selected old regions. Do not treat one illustrative sample as a universal rule: JIT warmup and heap history affect the observations. This lesson does not claim that this lab was executed.

For an incident, begin with the measured symptom. If pauses rose after a survival surge, compare young sizing, copying and remembered work. If old occupancy races upward, inspect marking start, IHOP predictions, concurrent progress and available headroom. If pauses lengthen under a CPU limit, compare quota, throttling and active-worker counts. Then repeat under the same workload after any change. Tuning a fixed flag without that causal chain may remove G1's ability to adapt.

## Check your reasoning

<details class="lesson-check"><summary>Does `MaxGCPauseMillis=200` guarantee every pause is below 200 ms?</summary><p>No. It is a soft policy goal based on predictions and can be missed when work or conditions differ from the estimate.</p></details>
<details class="lesson-check"><summary>Why can a larger young generation reduce frequency but increase pause duration?</summary><p>It allows more allocations between collections, while a later evacuation may scan and copy more live data and process more incoming references.</p></details>
<details class="lesson-check"><summary>Is adaptive IHOP permanently fixed at the initial 45% value?</summary><p>No. The initial percentage applies while G1 gathers enough observations; adaptive prediction then changes the start threshold.</p></details>
<details class="lesson-check"><summary>What happens if `ActiveProcessorCount=4` is used inside a two-core quota?</summary><p>HotSpot can size some internal policies as though four processors are active, but the kernel still enforces the two-core CPU quota.</p></details>

The complete model is **workload → observation → predicted cost and headroom → G1 choice → new observation**. The loop explains why defaults often work, why workload shifts cause misses, and why diagnostics should precede fixed tuning. [Lesson 52](/courses/jvm/jvm-memory-ergonomics-containers) moves from GC choices to the memory boundary that containers actually enforce.

<details class="lesson-sources"><summary>Sources and implementation boundaries</summary><p>Based on approved Daily JVM Byte #51 and its review. Tables, workloads and diagrams are illustrative; no lab run or measured flag output is claimed. Details describe JDK 25 HotSpot G1 and supported Linux container behavior; policy internals may vary by build and platform.</p><ul><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html">JDK 25 G1 collector and ergonomic defaults</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html">JDK 25 GC ergonomics</a></li><li><a href="https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html">JDK 25 java command options</a></li></ul></details>
