---
title: Platform threads vs virtual threads in JDK 25
summary: Separate Java thread identity from execution resources, follow a virtual thread through blocking and resumption, and understand what carriers and heap-managed stacks change.
course: jvm
lessonSlug: platform-vs-virtual-threads
module: Threads and Synchronization
order: 190
sourceByte: byte-019
draft: false
prerequisites: [thread-local-handshakes]
jdk: HotSpot · JDK 25 virtual threads and continuations
---

Imagine a request handler that loads a customer, waits for a remote service, and then builds a response. The Java code is straightforward. Most of the request's lifetime, however, might be spent waiting for data rather than using a processor.

If every request has a platform thread, every waiting request also keeps an operating-system thread associated with it. At high concurrency, the service can run out of practical thread capacity while its CPUs still have room for useful work.

Virtual threads let us keep that sequential, thread-per-task code while changing how waiting consumes execution resources. To understand the change, we need to separate the Java thread your application sees from the underlying thread currently executing its instructions.

<figure>
<a href="/images/courses/jvm/platform-vs-virtual-overview.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/platform-vs-virtual-overview.svg" alt="A platform thread keeps an OS-thread association. A virtual thread mounts on a carrier platform thread backed by an OS thread." width="480" height="338" /></a>
<figcaption>The carrier supplies execution; V1 keeps the Java identity. Mounted carriers can still be descheduled by the OS. <a href="/images/courses/jvm/platform-vs-virtual-overview.svg">Open full-size diagram</a>.</figcaption>
</figure>

In [Lesson 18](/courses/jvm/thread-local-handshakes), we coordinated HotSpot execution threads through handshakes. Here we refine what “thread” means: a Java `Thread`, a HotSpot execution structure, and an OS thread are related, but they are not interchangeable names for one permanent object.

## Platform threads keep an OS-thread association

A **platform thread** is a Java thread normally backed by one operating-system thread throughout its execution lifetime. The OS schedules that thread onto a processor. Its resources include native stack space and operating-system scheduling state.

For our request handler, a platform thread follows the call into a blocking socket read. While the read waits for bytes, the thread is not continuously using a CPU. But its OS-thread association and stack resources remain. Another request cannot borrow that same Java thread halfway through its unfinished call stack.

<figure>
<a href="/images/courses/jvm/platform-thread-resources.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/platform-thread-resources.svg" alt="A request blocks in a socket read. Its platform thread retains its OS thread, native stack resources, and OS bookkeeping while not using a CPU." width="480" height="338" /></a>
<figcaption>A blocked platform thread need not consume CPU, but it keeps its thread and stack resources. <a href="/images/courses/jvm/platform-thread-resources.svg">Open full-size diagram</a>.</figcaption>
</figure>

This is a reasonable model for modest concurrency. The difficulty is scaling the number of simultaneously waiting tasks. More platform threads mean more native stack reservations, OS bookkeeping, and scheduling work when those threads are runnable. Reserved stack space is not the same as resident physical memory, as we saw in [the process-memory lesson](/courses/jvm/memory).

The problem is therefore not that a waiting platform thread burns a whole CPU. It is that a task which needs no CPU right now still occupies a comparatively expensive execution resource.

## Virtual threads use reusable carriers

A **virtual thread** is a Java thread scheduled by the JDK onto platform threads. A platform thread executing a virtual thread is called its **carrier**. Each carrier is backed by an OS thread, which the operating system schedules normally.

<figure>
<a href="/images/courses/jvm/virtual-thread-carriers.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-carriers.svg" alt="Five virtual threads feed a JDK scheduler. It assigns runnable tasks to two reusable carrier platform threads, each backed by an OS thread." width="480" height="352" /></a>
<figcaption>Only runnable tasks need scheduling; waiting tasks still exist without each owning a carrier. <a href="/images/courses/jvm/virtual-thread-carriers.svg">Open full-size diagram</a>.</figcaption>
</figure>

Many virtual threads can exist while a much smaller set of carriers executes the runnable ones over time. A waiting virtual thread still exists: its task has not finished, its Java identity remains valid, and its execution state must be retained. It just need not occupy a carrier during a supported wait.

The scheduler does not turn every platform thread in the program into a carrier. Carriers are platform threads used by the virtual-thread scheduler; an ordinary platform thread running your own task is still a platform thread in its own right.

<mark>A virtual thread's identity and lifetime are independent of the carrier currently executing it.</mark>

The JDK 25 default scheduler uses a dedicated work-stealing pool, separate from the common pool used by parallel streams. Carrier count is a runtime scheduling matter, not one carrier per virtual thread and not a promise of one immutable carrier per CPU core. The central model does not depend on tuning that pool.

## Follow one request through mounting and blocking

**Mounting** connects a virtual thread's resumable execution to a carrier so its Java code can run. Suppose virtual thread V1 handles our customer request on Carrier A. While V1 runs, A's OS thread supplies the execution resource.

<figure>
<a href="/images/courses/jvm/virtual-thread-mounting.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-mounting.svg" alt="At an earlier time V1 runs on Carrier A. Later V1 is unmounted and V2 runs on the same Carrier A." width="480" height="338" /></a>
<figcaption>Mounting is a temporary execution association. One carrier does not execute V1 and V2 simultaneously. <a href="/images/courses/jvm/virtual-thread-mounting.svg">Open full-size diagram</a>.</figcaption>
</figure>

Now the handler reaches a socket read for which no data is available. For a JDK blocking operation integrated with virtual-thread scheduling, the runtime can suspend V1 and **unmount** it: detach its suspended Java execution from the carrier. Carrier A can then run V2 while V1 waits.

<figure>
<a href="/images/courses/jvm/virtual-thread-unmount-blocking.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-unmount-blocking.svg" alt="V1 runs on A, blocks and unmounts while A runs V2, then becomes runnable and resumes on B. Its Java identity persists across the wait." width="480" height="360" /></a>
<figcaption>Supported blocking can free a carrier. I/O readiness makes V1 runnable; it still needs to be scheduled. <a href="/images/courses/jvm/virtual-thread-unmount-blocking.svg">Open full-size diagram</a>.</figcaption>
</figure>

Follow the complete path rather than stopping at “the read blocks”:

1. V1 runs the request handler while mounted on Carrier A.
2. The socket read cannot complete immediately, so the runtime arranges to resume the task when it can make progress.
3. V1 suspends and unmounts on the supported path. It remains an unfinished Java thread.
4. Carrier A becomes available to execute V2 or another runnable virtual thread.
5. When the I/O is ready, V1 becomes eligible to run again. Readiness does not guarantee immediate CPU time.
6. The scheduler mounts V1 on an available carrier, perhaps Carrier B. The read continues and the handler resumes its sequential control flow.

V1 may resume on the same carrier or a different one. Its caller does not need to receive a new thread identity or manually rebuild the call stack. The runtime preserves the computation across that change.

This flow is conditional. A read that completes immediately may never suspend. Some blocking paths capture an OS thread, and some execution circumstances prevent unmounting. Also, a mounted carrier can itself be descheduled by the OS. “Mounted” describes the execution association; it does not mean instructions are executing on a CPU at every instant.

## Preserve the stack without owning a native stack forever

The request handler has unfinished method calls when it blocks. Recall from [Lesson 12](/courses/jvm/stack-frames-operand-stack) that a stack records the state needed to continue those calls, including local values and where execution should return. If V1 gives up Carrier A, that state must survive somewhere other than an exclusively owned native stack.

HotSpot's **continuation** machinery provides resumable Java execution: it can suspend a computation and later resume it with its required execution state. A virtual thread combines this capability with scheduling and the Java `Thread` API. A continuation is an internal implementation mechanism here, not a public API that application code must manipulate.

<figure>
<a href="/images/courses/jvm/continuation-model.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/continuation-model.svg" alt="VirtualThread holds Java-level identity and scheduling state. Continuation machinery preserves a resumable computation and its stack state across suspension." width="480" height="358" /></a>
<figcaption>A continuation supplies resumable execution; a virtual thread adds Java thread semantics and scheduling. <a href="/images/courses/jvm/continuation-model.svg">Open full-size diagram</a>.</figcaption>
</figure>

Suspended virtual-thread stack state uses **stack chunks**, heap-managed objects containing saved stack data and the information the runtime needs to interpret it. During execution, HotSpot runs frames on the carrier's native stack; suspension and resumption preserve and restore the necessary state through continuation machinery. The exact movement and representation are implementation details, not a requirement to copy every frame on every transition.

<figure>
<a href="/images/courses/jvm/virtual-thread-stack-chunks.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-stack-chunks.svg" alt="During execution V1 uses its carrier native stack. Suspension preserves required execution state in dynamically managed heap stack chunks; it is not one fixed chunk forever." width="480" height="358" /></a>
<figcaption>Conceptual storage view, not a literal object layout or a promise to copy every frame at each transition. <a href="/images/courses/jvm/virtual-thread-stack-chunks.svg">Open full-size diagram</a>.</figcaption>
</figure>

<mark>Suspended virtual-thread stack state is not permanently tied to one carrier's native stack.</mark>

Do not read the illustration as “one virtual thread owns exactly one permanent StackChunk.” Chunks can be linked and managed dynamically as stack needs change. The Java heap is garbage-collected, and retained execution state and referenced application objects still consume memory. A large number of suspended tasks is cheaper than giving every task a traditional native thread stack, but it is not free.

This connects back to both memory and execution: the logical sequence of Java calls survives even when its physical representation changes. Neither a Java method frame nor a virtual thread requires one fixed physical storage arrangement for its entire lifetime.

## Keep Java identity across carrier changes

Inside V1, `Thread.currentThread()` returns V1, not Carrier A or Carrier B. Its name, interrupt status, and `ThreadLocal` values belong to the virtual thread. Changing carriers does not exchange those values with V2's values.

Here is a small JDK 25 experiment that checks the application-visible identity across a blocking sleep. Save it as `VirtualIdentity.java` and run `java VirtualIdentity.java`. The main thread joins the virtual thread so the process waits for it to finish.

```java
public class VirtualIdentity {
    static final ThreadLocal<String> REQUEST =
        new ThreadLocal<>();

    public static void main(String[] args)
            throws InterruptedException {
        Thread worker = Thread.ofVirtual()
            .name("customer-request")
            .start(() -> {
                Thread before = Thread.currentThread();
                REQUEST.set("customer-42");
                try {
                    Thread.sleep(20);
                    System.out.println(
                        before == Thread.currentThread());
                    System.out.println(REQUEST.get());
                    System.out.println(before.getName());
                    System.out.println(before.isVirtual());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    REQUEST.remove();
                }
            });
        worker.join();
    }
}
```

The local run on Homebrew OpenJDK HotSpot 25.0.2 produced:

```text
true
customer-42
customer-request
true
```

This checks that the same Java thread and its thread-local value remain visible. It does **not** prove a carrier switch occurred: the scheduler is allowed to reuse the original carrier. The interrupt handler also follows ordinary Java practice, restoring the interrupt status after catching `InterruptedException` rather than silently discarding cancellation.

Normal thread identity does not imply every platform-thread attribute is identical. For example, virtual threads are daemon threads and have a fixed priority. Those API differences do not make the carrier the application's identity.

Thread-local values also have a scaling cost. A large reusable buffer cached once per thread in a small platform pool can become a large number of buffers when every concurrent task gets a virtual thread. Preserve request context where useful, but review expensive per-thread caches.

## Connect carriers back to TLAB allocation

[Lesson 8](/courses/jvm/tlabs-allocation) introduced the thread-local allocation buffer, or TLAB: a region from which HotSpot can allocate small objects using a fast local pointer update. “Thread-local” in TLAB and `ThreadLocal` do not name the same ownership mechanism.

HotSpot's allocation buffer belongs to its underlying execution-thread machinery. While V1 is mounted on Carrier A, allocations can use that execution thread's TLAB. After V1 unmounts, V2 running on A can use A's allocation fast path. If V1 later runs on B, it uses the machinery associated with B.

There is no permanent TLAB reserved for each virtual thread across its lifetime. A million virtual threads therefore do not imply a million simultaneously reserved TLABs. Objects allocated by V1 still live according to ordinary reachability; changing carriers does not move them into another thread's ownership or make them disappear. Allocation outside the TLAB and configurations without TLABs remain possible.

This also sharpens the previous lesson's terminology. A Java `Thread` is the object application code sees; HotSpot's `JavaThread` is an internal execution structure involved in native stacks, allocation, and runtime coordination. Do not multiply every carrier-level runtime structure by the number of suspended virtual threads.

## Concurrency scales; CPU capacity does not

**Concurrency** is the number of tasks whose lifetimes overlap. **Parallelism** is the amount of work actually executing at the same time. Waiting requests contribute to concurrency even while none of their Java instructions is executing.

<figure>
<a href="/images/courses/jvm/virtual-threads-cpu-bound.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-threads-cpu-bound.svg" alt="One hundred thousand CPU-bound virtual threads still depend on a finite set of carriers and eight illustrative CPU execution slots." width="480" height="352" /></a>
<figcaption>Concurrency counts overlapping tasks. Parallel execution is bounded by CPU availability, not virtual-thread count. <a href="/images/courses/jvm/virtual-threads-cpu-bound.svg">Open full-size diagram</a>.</figcaption>
</figure>

<mark>Virtual threads make large blocking concurrency practical; they do not create more CPU parallelism.</mark>

If a workload spends most of its time computing, adding 100,000 virtual threads does not give it 100,000 processors. Runnable tasks still compete for carriers and the CPU capacity available to the process. Hardware threads, container CPU limits, and other work also affect that capacity; the diagram's eight execution slots are an illustrative budget, not a universal core-to-thread formula.

The gain is strongest for tasks that frequently wait on supported blocking I/O or synchronization. Carriers can work on runnable requests instead of remaining associated with idle waits. That can increase throughput under load; it does not make the remote service answer an individual request faster.

For our handler, this makes **thread-per-task** practical again: keep one virtual thread for the request, write ordinary sequential calls, and let supported waits release execution resources. `Executors.newVirtualThreadPerTaskExecutor()` creates a new virtual thread for each submitted task. It is not a fixed pool of virtual threads to reuse between unrelated requests. Asynchronous designs remain useful where appropriate; the benefit here is keeping blocking control flow without one OS thread per waiting task.

## JDK 25: synchronized no longer inherently pins

**Pinning** means a virtual thread cannot unmount from its carrier at a point where it would otherwise suspend. Older virtual-thread explanations often associate this with blocking inside a `synchronized` method or block. That is not the general rule for this course's JDK 25 baseline.

<figure>
<a href="/images/courses/jvm/jdk25-synchronized-virtual-thread.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/jdk25-synchronized-virtual-thread.svg" alt="In JDK 25 V1 can unmount during a supported wait while holding an ordinary monitor. Its carrier can run V3, but V2 still waits for the same monitor." width="480" height="338" /></a>
<figcaption>Unmounting does not release a monitor held across sleep or I/O. Object.wait has its own monitor-release semantics. <a href="/images/courses/jvm/jdk25-synchronized-virtual-thread.svg">Open full-size diagram</a>.</figcaption>
</figure>

<aside class="lesson-callout" data-kind="misconception" aria-label="Common misconception">
<p class="callout-label">Common misconception</p>
<p>Ordinary <code>synchronized</code> does not inherently pin virtual threads in JDK 25. <a href="https://openjdk.org/jeps/491">JEP 491</a>, delivered in JDK 24, allows virtual threads to unmount when blocking while holding ordinary Java monitors. Older advice to replace every <code>synchronized</code> block solely to avoid this pinning is outdated for this baseline.</p>
</aside>

A **monitor** is the mutual-exclusion mechanism used by `synchronized`. Releasing a carrier is different from releasing that monitor. If our handler sleeps or performs supported I/O while holding a monitor, another thread trying to acquire that same monitor must still wait. `Object.wait()` is different: it releases the monitor it waits on and reacquires it before returning, under its normal Java contract.

JEP 491 therefore improves execution-resource reuse without abolishing lock contention. Holding a shared lock across a slow network operation can still serialize requests even when it no longer inherently pins the carrier.

Some circumstances still prevent unmounting. Native methods and foreign-function calls are an important boundary, including a native call that calls back into Java and then blocks with a native frame still present. Native blocking can also occupy the OS thread directly. Do not turn the synchronized correction into “all blocking always frees the carrier.”

When investigating this in a real workload, look for evidence of retained carriers rather than treating every delay as pinning. JDK Flight Recorder's `jdk.VirtualThreadPinned` event can identify pinning that meets its configured recording threshold. Absence of such events does not prove the service has no contention, CPU saturation, downstream waits, or other carrier-capturing paths.

## Protect the resource behind the wait

Suppose 100,000 virtual threads reach a database pool containing 100 connections. They do not acquire 100,000 connections. At most the pool's available capacity can be checked out, and the other tasks must wait, time out, or be rejected according to the application's policy.

<figure>
<a href="/images/courses/jvm/virtual-thread-resource-limit.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-resource-limit.svg" alt="Many virtual-thread requests converge on a pool with one hundred database connections. Waiting tasks remain outside that finite downstream capacity." width="480" height="354" /></a>
<figcaption>Illustrative counts. A pool caps checked-out connections; admission, deadlines, and rate limits address other constraints. <a href="/images/courses/jvm/virtual-thread-resource-limit.svg">Open full-size diagram</a>.</figcaption>
</figure>

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>Virtual threads reduce the need to limit concurrency merely to protect OS-thread counts. You may still need limits around scarce resources: database connections, remote-service capacity, file descriptors, and rate limits. A cheaper waiting thread does not increase the capacity of the system it is waiting for.</p>
</aside>

A fixed platform-thread pool often limited both OS threads and downstream work. With virtual threads, make the downstream limit explicit. A connection pool already caps checked-out connections; do not automatically add another semaphore with the same purpose. For a remote service that needs a separate in-flight limit, a shared semaphore can express that constraint around the call.

Concurrency limits and rate limits solve different problems: ten simultaneous calls does not mean ten calls per second. Also, even cheap waiting tasks retain request data and consume time. Bound admission or backlog where needed and use appropriate deadlines, rather than accepting unlimited work and assuming virtual threads make the queue harmless.

## Compare the two execution models

<div class="lesson-table-scroll" role="region" aria-label="Platform and virtual thread comparison" tabindex="0">
<table class="lesson-comparison">
<caption>Platform and virtual thread execution models</caption>
<thead><tr><th scope="col">Property</th><th scope="col">Platform thread</th><th scope="col">Virtual thread</th></tr></thead>
<tbody>
<tr><th scope="row">Java identity</th><td>A Java <code>Thread</code></td><td>A Java <code>Thread</code></td></tr>
<tr><th scope="row">OS association</th><td>Normally one for its lifetime</td><td>Uses a carrier while mounted</td></tr>
<tr><th scope="row">Carrier role</th><td>Can serve as a carrier</td><td>Executes on a carrier</td></tr>
<tr><th scope="row">Blocking wait</th><td>Retains its OS thread</td><td>Supported paths can unmount</td></tr>
<tr><th scope="row">Stack model</th><td>Native-thread stack resources</td><td>Continuation-backed heap chunks plus carrier stack while running</td></tr>
<tr><th scope="row">Large blocking concurrency</th><td>Limited by OS-thread costs</td><td>Designed to scale this model</td></tr>
<tr><th scope="row">CPU capacity</th><td>Hardware and process limits</td><td>Same hardware and process limits</td></tr>
<tr><th scope="row">Downstream capacity</th><td>Must be respected</td><td>Must still be respected</td></tr>
</tbody>
</table>
</div>

The major shift is in how execution resources are assigned over time. Java thread identity remains meaningful in both models; a virtual thread is not a callback that inherits whichever carrier's application state happens to run it.

## Check your reasoning

There are 50,000 virtual threads and 16 carriers. Does that mean only 16 virtual threads can exist?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. Many virtual threads can exist in waiting or runnable states. At a given instant, each carrier executes at most one virtual thread, and actual simultaneous execution is also constrained by CPU availability. Existence, eligibility to run, and CPU execution are different states.</p>
</details>

V1 sets a `ThreadLocal`, blocks, and resumes on a different carrier. Should it now read the new carrier's value?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. The value belongs to V1's Java thread identity. The runtime changes the execution resource while preserving V1's thread semantics. Its TLAB allocation path can change with the carrier because TLAB ownership is a different, internal mechanism.</p>
</details>

On JDK 25, V1 performs supported blocking I/O inside `synchronized (lock)`. V2 wants the same lock. Does freeing V1's carrier let V2 enter the block immediately?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. Ordinary monitor ownership no longer inherently prevents unmounting, but V1 still owns the monitor across that I/O. Carrier reuse and lock availability are separate. V2 must wait for the monitor to become available; JEP 491 does not remove mutual exclusion.</p>
</details>

A service becomes CPU-bound after switching to virtual threads. Would accepting ten times as many concurrent requests necessarily improve throughput?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. More runnable tasks do not supply more CPU capacity and can increase queues and latency. First establish whether the constraint is CPU work, occupied carriers, a lock, or downstream capacity. The appropriate concurrency limit follows the scarce resource, not the maximum number of virtual threads the JVM can create.</p>
</details>

## Put the lifecycle together

Our request has one Java-thread lifetime but can use several execution resources over that lifetime. It starts, runs on a carrier, suspends with execution state preserved, becomes runnable, resumes on an available carrier, and finally completes. The carrier can serve other virtual threads between those steps.

<figure>
<a href="/images/courses/jvm/virtual-thread-complete.svg" aria-label="Open diagram at full size"><img src="/images/courses/jvm/virtual-thread-complete.svg" alt="V1 starts, mounts on A, suspends with heap-managed state while A serves another task, becomes runnable, mounts on B, and completes." width="480" height="382" /></a>
<figcaption>The virtual-thread lifetime spans multiple execution intervals. The carrier remains a reusable resource after V1 completes. <a href="/images/courses/jvm/virtual-thread-complete.svg">Open full-size diagram</a>.</figcaption>
</figure>

This ties together the earlier memory and execution lessons: native stacks still exist on carriers, suspended Java execution can use heap-managed chunks, allocation uses the current execution machinery, and Java-level identity survives those implementation changes. Scalability comes from avoiding a dedicated OS thread for each supported wait, while CPU, heap, locks, and downstream systems retain their own limits.

The next question is what happens inside the monitor itself. The [HotSpot synchronization internals preview](/courses/jvm/synchronization-internals) leads into lightweight locking, contention, and mark-word behavior in JDK 25. We will connect the object-header model from Lesson 3 to synchronization without carrying forward older locking assumptions as universal rules.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Based on Daily JVM Byte #19, the retrieved reviewed draft, and its explicitly retained review requirements. The originating draft retrieval ends during its reasoning checks; the complete byte and retrieved draft excerpt are archived with review notes. Diagrams, request counts, and carrier transitions are illustrative. The identity example was run on Homebrew OpenJDK HotSpot 25.0.2; it checks Java identity and thread-local behavior, not a forced carrier migration or throughput claim. Continuations, chunks, TLAB ownership, and scheduling internals describe HotSpot/JDK 25 rather than a mandated JVMS representation. JEP 444 explains the original virtual-thread design; its historical synchronized-pinning discussion must be read with JEP 491's later correction.</p>
<ul>
<li><a href="https://openjdk.org/jeps/444">JEP 444: Virtual Threads, scheduling and heap-managed stacks</a></li>
<li><a href="https://openjdk.org/jeps/491">JEP 491: Synchronize Virtual Threads without Pinning</a></li>
<li><a href="https://www.oracle.com/java/technologies/javase/24-relnote-issues.html">JDK 24 release notes: delivered synchronized-pinning change</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html">JDK 25 virtual-thread guide: blocking, adoption, resource limits, and JFR</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html">JDK 25 Thread API: identity, attributes, and virtual threads</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/lang/VirtualThread.java">JDK 25 VirtualThread implementation: continuation and carrier machinery</a></li>
<li><a href="https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/runtime/thread.hpp">JDK 25 HotSpot Thread implementation: execution-thread TLAB storage</a></li>
</ul>
</details>
