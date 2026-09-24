---
title: Thread-local handshakes — coordination without stopping the whole JVM
summary: See how HotSpot coordinates runtime work with selected Java threads, using safe states and thread-local polling without requiring a global safepoint.
course: jvm
lessonSlug: thread-local-handshakes
module: Threads and Synchronization
order: 180
sourceByte: byte-018
draft: false
prerequisites: [safepoints]
jdk: HotSpot · JDK 25 thread-local handshakes
---

In the previous lesson, HotSpot needed every relevant Java thread to reach, or already be in, a state the runtime could safely account for. Only then could a global VM operation begin.

That coordination is appropriate when the operation needs a globally consistent JVM state. But imagine a service with 500 application threads when HotSpot needs cooperation from only one of them:

```text
target: Thread 217
work:   inspect or update state associated with that thread
```

Bringing the other 499 threads into a global safepoint would widen the disruption without helping the operation.

A **thread-local handshake** gives HotSpot a narrower choice. It requests a callback for one Java thread or a selected set of Java threads, waits until each target can be handled safely, performs the work, and lets unrelated threads continue.

<figure>
<a href="/images/courses/jvm/handshake-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/handshake-overview.svg" alt="Thread 217 observes a targeted handshake request, reaches a safe state, has its operation processed, and continues while four unrelated threads keep running." width="480" height="300" /></a>
<figcaption>A handshake narrows coordination to the threads whose state the operation actually needs. <a href="/images/courses/jvm/handshake-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

<mark>The headline difference is scope: a global safepoint coordinates all relevant Java threads, while a handshake coordinates selected Java threads.</mark>

This is HotSpot implementation machinery, introduced by [JEP 312](https://openjdk.org/jeps/312) and present in JDK 25. It is not a Java-language API that application code calls directly, and the Java Virtual Machine Specification does not require this protocol.

## Compare the coordination scope

Place the two mechanisms side by side:

```text
global safepoint                    thread-local handshake

T1 ─┐                               T1 ───────── continues
T2 ─┤                               T2 ───────── continues
T3 ─┼─ become accountable           T3 ─► safe state ─► callback ─► continue
T4 ─┤                               T4 ───────── continues
T5 ─┘                               T5 ───────── continues
     │
     ▼
global VM operation
```

<figure>
<a href="/images/courses/jvm/global-vs-handshake.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/global-vs-handshake.svg" alt="A comparison shows a global safepoint coordinating five Java threads before one VM operation, while a handshake coordinates only Thread 3 and leaves the other four running." width="480" height="300" /></a>
<figcaption>Both mechanisms require safe access to thread state; they differ in how broadly they coordinate. <a href="/images/courses/jvm/global-vs-handshake.svg">Open full-size diagram</a>.</figcaption>
</figure>

Calling a handshake “a mini-safepoint” hides too much. It suggests the global protocol merely shrinks, but the useful model is **selected-thread runtime coordination**. There is no globally synchronized JVM state, and unrelated threads do not have to wait for the target's callback to finish.

That narrower scope was JEP 312's central scalability motivation. As thread counts grow, the difference between coordinating one thread and coordinating every thread becomes increasingly valuable.

## Safepoints and handshakes share polling machinery

Lesson 17 introduced compiled-code polls. During ordinary execution, a thread follows the cheap no-work path. When HotSpot requests coordination, the poll brings the thread into runtime machinery at a state the VM can understand.

JDK 25 HotSpot stores polling state per `JavaThread`. That state can represent several reasons for the thread to enter the runtime, including global safepoint work and thread-local handshake work.

```text
per-thread polling state
        │
        ├── global safepoint requested
        ├── handshake requested for this thread
        └── other runtime-local conditions
                 │
                 ▼
       thread processes requested work
```

<figure>
<a href="/images/courses/jvm/thread-local-polling.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/thread-local-polling.svg" alt="Each JavaThread has local polling state. A global safepoint arms all relevant threads, while a handshake arms only selected target threads; both routes enter shared polling and runtime processing machinery." width="480" height="300" /></a>
<figcaption>Global and targeted coordination share per-thread polling infrastructure, but HotSpot arms a different scope. <a href="/images/courses/jvm/thread-local-polling.svg">Open full-size diagram</a>.</figcaption>
</figure>

This does not mean every poll runs a handshake callback or that every source-level loop has one fixed poll. Poll placement and implementation remain compiler, runtime, and platform details. The stable idea is that HotSpot can make a request visible to the relevant execution thread without first establishing a global safepoint.

## Follow one target through a handshake

Suppose HotSpot wants a callback performed for `JavaThread A`. A simplified path is:

1. Runtime code creates a handshake operation and selects `JavaThread A`.
2. HotSpot queues the operation in A's handshake state.
3. HotSpot arms A's local poll so the pending work becomes observable.
4. A reaches an appropriate poll or runtime transition.
5. The handshake callback runs while A's state is safe for that operation.
6. The operation is marked complete, and A continues Java execution.

<figure>
<a href="/images/courses/jvm/handshake-flow.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/handshake-flow.svg" alt="A six-stage sequence queues a handshake for JavaThread A, arms its local poll, reaches a safe state, runs the callback, marks the operation complete, and resumes Java execution." width="480" height="320" /></a>
<figcaption>The target's normal execution path provides a cooperative route into the runtime; the sequence is simplified and state-dependent. <a href="/images/courses/jvm/handshake-flow.svg">Open full-size diagram</a>.</figcaption>
</figure>

The word **callback** here means a piece of internal VM work represented by a HotSpot `HandshakeClosure`. It is not an arbitrary application lambda, and not every closure is suitable for every execution path.

The operation can target one thread, a selected set, or all Java threads while still allowing each thread to complete its own work independently. An all-thread handshake is therefore still different from a global safepoint: the threads do not have to become globally stopped together before one shared operation begins.

## The target thread does not always run the callback itself

The cooperative path is the easiest one to picture: the target notices its poll and processes its own pending handshake. It is not the complete implementation.

If a target is already in a state HotSpot can safely inspect, the requesting runtime thread may be able to process suitable handshake work **on behalf of** that target. Current HotSpot checks both the target's state and properties of the queued operation before allowing external processing.

```text
target running Java code
        │
        └── target reaches poll and processes its handshake

target already safely blocked / otherwise handshake-safe
        │
        └── HotSpot may process suitable work on its behalf
```

<mark>A handshake belongs to the target thread's state, but the target thread does not always literally execute the callback.</mark>

This distinction matters because “thread-local” describes the coordination target, not a guarantee about which CPU or VM thread executes every instruction in the callback. Some operations require the target to process them itself; others allow external processing when HotSpot has established a safe relationship with the target.

## Safe-state requirements still apply

A targeted request does not make arbitrary machine state understandable. If `JavaThread A` is halfway through optimized instructions, object references and logical Java values may be moving among registers and stack slots just as they were in the safepoint lesson.

HotSpot still needs a state in which the requested operation is valid:

```text
handshake requested
        │
        ▼
is target state safe for this operation?
        │
   ┌────┴────┐
   │         │
  yes        no
   │         │
process      target must advance or transition
work         to a suitable state
```

<figure>
<a href="/images/courses/jvm/handshake-safe-state.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/handshake-safe-state.svg" alt="A handshake request branches on whether the target JavaThread is safe for the operation. A safe target can be processed; an unsafe target advances to a poll or transition before callback work runs." width="480" height="300" /></a>
<figcaption>Targeted coordination narrows the participants; it does not remove the need for a state the runtime can safely use. <a href="/images/courses/jvm/handshake-safe-state.svg">Open full-size diagram</a>.</figcaption>
</figure>

This is why the phrase “stop one thread at any instruction” is misleading. The target must cooperate or already satisfy HotSpot's state checks, and the callback's own rules determine what may safely be done.

## Narrower coordination improves scalability

Return to the JVM with 500 application threads. If the operation needs only Thread 217, a global safepoint creates coordination work across the complete relevant set:

```text
500 threads
     │
     ├── arm polls broadly
     ├── account for varied thread states
     ├── wait for the slowest required arrival
     └── release global coordination
```

A single-thread handshake reduces that coordination surface:

```text
Thread 217
     │
     ├── queue targeted operation
     ├── reach or recognize safe state
     └── complete callback
```

<figure>
<a href="/images/courses/jvm/handshake-scalability.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/handshake-scalability.svg" alt="A global safepoint fans out to 500 threads and waits for the full relevant set, while a handshake follows one path to Thread 217 and leaves the remaining 499 outside the coordination boundary." width="480" height="300" /></a>
<figcaption>The gain comes from reducing the number of threads that must participate, especially as thread counts rise. <a href="/images/courses/jvm/handshake-scalability.svg">Open full-size diagram</a>.</figcaption>
</figure>

This does not promise that every handshake is faster than every safepoint. Callback cost, target state, contention, scheduling, and the number of selected targets all matter. The architectural gain is that operations whose correctness is thread-local no longer require global coordination by default.

## A handshake is not zero pause or zero cost

The target thread can still stop doing application work while its handshake is processed. If the operation targets several threads, each can experience delay. The requester may also wait for every selected target to finish, and a target that takes time to reach a suitable state can extend the operation's completion time.

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>A thread-local handshake avoids stopping unrelated threads, but it does not make coordination free. Investigate which threads were targeted, how long they took to become handshake-safe, and how much work the callbacks performed before describing an observed delay as negligible.</p>
</aside>

The responsiveness question changes with the scope:

```text
global safepoint responsiveness
→ how long until every required Java thread is accounted for?

target-thread handshake responsiveness
→ how long until the selected target can complete its operation?
```

<mark>Global safepoint latency is governed by the required thread set; handshake latency is governed by the selected target set and its work.</mark>

The two can share causes, such as a thread taking a long time to reach a suitable poll, but they describe different coordination events. Do not read a safepoint timing field as a universal measure of handshake responsiveness.

## Handshakes do not replace global safepoints

Some VM work truly needs a globally consistent state. A stop-the-world collection phase, for example, may need all relevant mutator threads prevented from changing the heap while the collector performs global work. A one-thread handshake cannot provide that invariant.

The runtime therefore chooses based on the operation's required scope:

<figure>
<a href="/images/courses/jvm/coordination-choice.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/coordination-choice.svg" alt="A decision diagram asks what state an operation needs. Work concerning selected JavaThreads uses handshakes, while work requiring a globally coordinated JVM state uses a global safepoint." width="480" height="300" /></a>
<figcaption>The operation's correctness requirement determines the coordination scope; a handshake is not a universal replacement. <a href="/images/courses/jvm/coordination-choice.svg">Open full-size diagram</a>.</figcaption>
</figure>

That gives us a practical rule:

```text
needs selected thread state  → consider a handshake
needs global JVM state       → use a global safepoint
```

The exact choice remains internal HotSpot policy and implementation. The rule is a reasoning tool, not an application tuning switch.

## Observability is one useful example

Runtime observability often needs information associated with a particular thread, such as a stack trace or execution sample. Coordinating with that thread can be safer than asynchronously inspecting it at an arbitrary instruction and less disruptive than stopping the whole JVM.

JDK Flight Recorder uses cooperative mechanisms in parts of its thread sampling implementation. That makes JFR a useful example of why thread-local coordination exists, but it does not mean every JFR event is a handshake or that understanding JFR requires memorizing handshake internals. The important connection is narrower:

```text
observability needs selected thread state
                  │
                  ▼
targeted safe coordination can avoid a global stop
```

When diagnosing latency, correlate evidence rather than assuming every pause is a global safepoint. Safepoint logs answer questions about global synchronization. JFR and other runtime evidence may reveal thread sampling, scheduling, or target-specific activity. Each signal has its own scope.

## Check your reasoning

HotSpot requests a handshake for Thread 217. Thread 318 continues executing application code. Does Thread 318 continuing prove the handshake failed?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. That is the expected result of targeted coordination. If the operation only concerns Thread 217, unrelated Thread 318 does not need to stop. Success depends on the selected target safely completing the requested work, not on establishing a global stop.</p>
</details>

Now suppose Thread 217 is blocked in a state HotSpot recognizes as safe for a particular externally executable handshake operation. Must Thread 217 wake up and execute the callback itself?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>Not necessarily. HotSpot may process suitable handshake work on behalf of a target that is already handshake-safe. Whether it can do so depends on the target state and the operation's rules; “thread-local” identifies whose state is being coordinated, not who must execute every callback instruction.</p>
</details>

Finally, imagine an operation must prevent all application threads from mutating a shared runtime structure while the operation runs. Would converting it to one handshake per thread automatically provide the same global invariant?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. Separate handshakes can complete at different times, and each thread may continue after its own operation finishes. Work that depends on all relevant threads being held in one globally coordinated state still needs a global safepoint or another mechanism that explicitly provides that invariant.</p>
</details>

## Put both coordination mechanisms together

HotSpot now has two related tools rather than one universal stop:

```text
runtime operation
       │
       ▼
what scope does correctness require?
       │
       ├── selected JavaThread state
       │          │
       │          ▼
       │    thread-local handshake
       │    local poll / safe state
       │    target-specific callback
       │
       └── globally coordinated JVM state
                  │
                  ▼
             global safepoint
             all relevant threads accounted for
             global VM operation
```

<figure>
<a href="/images/courses/jvm/safepoint-handshake-complete.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/safepoint-handshake-complete.svg" alt="A runtime operation selects either a thread-local handshake for selected JavaThread state or a global safepoint for globally coordinated JVM state. Both paths rely on polling, safe states, and runtime metadata." width="480" height="330" /></a>
<figcaption>Polling and safe-state machinery support two scopes: selected-thread callbacks and globally coordinated VM operations. <a href="/images/courses/jvm/safepoint-handshake-complete.svg">Open full-size diagram</a>.</figcaption>
</figure>

One boundary remains. In JDK 25, Java code can create both **platform threads** and **virtual threads**. HotSpot's internal `JavaThread` is tied to an operating-system-backed execution thread, while a virtual thread can mount on and unmount from a carrier platform thread. The next lesson will separate those layers and show why “one Java `Thread` equals one OS thread” is no longer a safe assumption.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Adapted from Daily JVM Byte #18 and its reviewed draft requirements. Thread counts, timelines, callback names, and diagrams are illustrative; no timing experiment was run. Claims describe JDK 25 HotSpot implementation rather than a JVMS requirement. Exact polling, external-processing eligibility, and handshake consumers can vary by build, platform, and JDK release.</p>
<ul>
<li><a href="https://openjdk.org/jeps/312">JEP 312: Thread-Local Handshakes</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/handshake.hpp">JDK 25 handshake operations, closures, and per-thread state</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/handshake.cpp">JDK 25 handshake execution and target-state checks</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/safepointMechanism.hpp">JDK 25 shared safepoint and thread-local polling mechanism</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/safepoint.hpp">JDK 25 handshake-safe target processing boundary</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/jfr/periodic/sampling/jfrThreadSampler.cpp">JDK 25 JFR cooperative thread-sampling implementation</a></li>
</ul>
</details>
