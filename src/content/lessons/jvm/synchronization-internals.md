---
title: synchronized internals — lightweight locking and monitor inflation
summary: Follow intrinsic synchronization from JVM monitor semantics through JDK 25 HotSpot lightweight locking, contention, wait sets, and virtual-thread state.
course: jvm
lessonSlug: synchronization-internals
module: Threads and Synchronization
order: 200
sourceByte: byte-020
draft: true
prerequisites: [platform-vs-virtual-threads]
jdk: HotSpot · JDK 25 lightweight locking
---

You add `synchronized` around a short update because two requests can modify the same account at once:

```java
synchronized (account) {
    account.update();
}
```

The Java rule is clear: one thread at a time owns that monitor, and the monitor is released when the region finishes, including when it exits by throwing an exception. The implementation question is less obvious: does every entry allocate a heavyweight monitor and ask the operating system to block?

On JDK 25 HotSpot, usually not. HotSpot uses a lightweight locking path for the common uncontended case and can move to an `ObjectMonitor` when it needs richer state. These are runtime representations of the same Java monitor semantics.

<figure>
<a href="/images/courses/jvm/synchronized-overview.svg" aria-label="Open synchronized locking overview"><img src="/images/courses/jvm/synchronized-overview.svg" alt="A synchronized operation follows one Java monitor contract. HotSpot usually handles uncontended ownership with lightweight locking and can inflate to an ObjectMonitor for contention or richer monitor operations." width="900" height="510" /></a>
<figcaption>One monitor contract can have different HotSpot representations as the work required by the lock changes. The paths are conceptual, not a promise that every contended attempt inflates.</figcaption>
</figure>

<mark>`synchronized` is the Java/JVM monitor abstraction; an `ObjectMonitor` is one HotSpot representation of that abstraction.</mark>

## What synchronization means to the JVM

A synchronized block and a synchronized method have the same monitor semantics, but the class file represents them differently.

For a block, the compiler emits monitor operations around the protected bytecode:

```text
synchronized (account) {
    account.update();
}

monitorenter account
    protected instructions
monitorexit account
```

The compiler also arranges for the monitor to be released on exceptional exits. At the JVM level these are the `monitorenter` and `monitorexit` instructions.

A synchronized method is marked with the `ACC_SYNCHRONIZED` method flag. The invocation machinery acquires the monitor before the body runs and releases it when the invocation completes. An instance method uses the receiver (`this`); a static method uses the `Class` object for the declaring class. It does not normally need explicit `monitorenter` and `monitorexit` instructions in the method body.

Both forms participate in Java monitor semantics, including mutual exclusion, visibility across unlock/lock, and reentrancy. The monitor is tied to the chosen object, so unrelated code that does not use the same monitor is not excluded from accessing that object's fields.

## Why the uncontended path matters

When one thread enters and leaves a small synchronized region without another thread trying to acquire the same monitor, queueing and sleeping would add work without helping anyone make progress. HotSpot therefore tries a short fast path for this common case.

The object header participates in that path. An ordinary HotSpot object has a **Mark Word**, a machine-word-sized header field that also carries information such as identity-hash and garbage-collector state. In the JDK 25 lightweight-locking model, low lock-state bits distinguish a neutral object, a fast-locked object, and an object whose lock state is represented by a monitor. Exact header layout has configuration and implementation details; this diagram shows only the lock-state role.

<figure>
<a href="/images/courses/jvm/lightweight-lock-markword.svg" aria-label="Open lightweight-lock Mark Word diagram"><img src="/images/courses/jvm/lightweight-lock-markword.svg" alt="The object's Mark Word carries a lock-state encoding. The owning HotSpot JavaThread tracks lightweight-locked object references in its LockStack; an inflated state identifies an ObjectMonitor representation." width="900" height="500" /></a>
<figcaption>The Mark Word says which lock state applies, while the thread's LockStack records objects owned through lightweight locking. This is the JDK 25 mental model, not a full object-header map.</figcaption>
</figure>

Older HotSpot diagrams often show the Mark Word being replaced with a pointer to a `BasicLock` record on a thread's stack. That describes the earlier stack-locking representation. It is not the right default picture for JDK 25 lightweight locking: the normal path keeps lock-state bits in the Mark Word and ownership bookkeeping in a HotSpot `LockStack` associated with the executing Java thread.

On an uncontended entry, HotSpot examines the object's lock state and attempts an atomic transition to the fast-locked state. The owning thread records the object in its LockStack as part of the protocol. The atomic transition arbitrates between threads that race to acquire the same neutral object; only one can establish fast ownership at a time. The exact instruction sequence and bookkeeping order depend on the runtime and processor.

<figure>
<a href="/images/courses/jvm/lightweight-lock-fast-path.svg" aria-label="Open lightweight locking fast-path diagram"><img src="/images/courses/jvm/lightweight-lock-fast-path.svg" alt="A thread reads the Mark Word, atomically claims a neutral lock state, records the object in its LockStack and enters. A competing transition takes a slow path." width="900" height="500" /></a>
<figcaption>The atomic header transition chooses an owner when two threads race; the LockStack supports ownership checks and unlock bookkeeping.</figcaption>
</figure>

The fast path still preserves Java's reentrancy rule. If a thread already owns a monitor, it may enter it again, and each matching exit reverses one acquisition. HotSpot's lightweight and inflated representations must preserve that rule, but the implementation can account for recursive ownership differently across representations. You should reason from the Java rule rather than assume one particular recursion counter layout.

## When HotSpot needs an ObjectMonitor

Now let Thread A hold `account` while Thread B tries to enter. B cannot run the protected region yet. HotSpot has more work to coordinate: ownership, recursive entry, entrants, threads that have called `wait()`, and parking or waking threads that cannot proceed.

HotSpot can **inflate** the lock, moving its representation to an `ObjectMonitor`. The object's Mark Word then indicates the monitor representation. An `ObjectMonitor` provides richer runtime state, including an owner, recursion bookkeeping, contender/entry structures, and a wait set. HotSpot can spin briefly in some situations and may park a thread when waiting is more appropriate; it uses runtime and operating-system support to park and wake threads.

<figure>
<a href="/images/courses/jvm/monitor-inflation.svg" aria-label="Open monitor inflation diagram"><img src="/images/courses/jvm/monitor-inflation.svg" alt="A lightweight lock can transition to an ObjectMonitor that holds owner and recursion state, an entry path for contenders, a wait set and park-unpark coordination." width="900" height="520" /></a>
<figcaption>Inflation adds a richer representation for coordination. It does not mean that every operation becomes a direct call to an OS mutex.</figcaption>
</figure>

Inflation is a **representation transition**, not a synonym for “use an OS mutex.” HotSpot's monitor code manages ownership and queues in the JVM, may spin, and can use park/unpark machinery when threads need to sleep. The kernel scheduler becomes relevant when a platform thread is parked, but it is not the definition of an inflated Java monitor.

Also, “contended” does not mean every collision must immediately inflate. HotSpot has fast and slow paths, and details vary by configuration and release. Inflation is available when the runtime needs monitor state that is not conveniently represented by the lightweight path.

## Entry contention is different from `wait()`

Two states are easy to confuse because both can leave a thread unable to run inside a synchronized region.

If Thread B reaches `monitorenter` while Thread A owns the monitor, B is an **entry contender**. B has not acquired the monitor and cannot execute the critical section.

`Object.wait()` has a different contract. The calling thread must already own the object's monitor. Calling `wait()` releases that monitor and places the caller in the object's wait set. After notification, timeout, or interruption makes it eligible to continue, the thread must reacquire the same monitor before `wait()` returns. Notification does not transfer ownership directly to the notified thread.

<figure>
<a href="/images/courses/jvm/monitor-entry-vs-waitset.svg" aria-label="Open entry contention and wait-set comparison"><img src="/images/courses/jvm/monitor-entry-vs-waitset.svg" alt="A thread blocked trying to enter belongs to the monitor's contender path. A thread calling wait first releases its monitor, waits in the wait set, then competes to reacquire before wait returns." width="900" height="540" /></a>
<figcaption>Entry contention waits to acquire. `wait()` begins while owning, releases the monitor, and later has to reacquire it.</figcaption>
</figure>

<mark>`wait()` releases the monitor while the thread waits, then reacquires it before returning; notification only makes the waiter eligible to compete again.</mark>

The JLS defines a wait set for each object monitor. In HotSpot, `wait()` needs that richer wait-set state, so it can cause the lightweight representation to inflate even when a long queue of entrants was not what prompted the transition. This is why a monitor can inflate because an operation needs monitor facilities, not only because a benchmark created heavy contention.

## The representation can change back

Inflation does not mean “heavyweight forever.” Once an inflated monitor is inactive and eligible for reclamation, HotSpot can deflate it and reclaim the runtime monitor structure. Deflation must coordinate safely with threads that may still be entering, exiting, waiting, or observing the object, so reclamation is a managed runtime operation rather than an immediate reversal at the end of a critical section.

Think of the lock representation as having a lifecycle: a neutral or lightweight state can become inflated when richer state is needed, and an idle inflated monitor can later be eligible for deflation.

## Why this connects to virtual threads

Lesson 19 separated a virtual thread's Java identity from the carrier that happens to execute it. That distinction matters here because lightweight lock ownership is associated with a HotSpot thread's LockStack, while a virtual thread can unmount from one carrier and later resume on another.

JEP 491, delivered in JDK 24 and included in JDK 25, changed HotSpot so ordinary intrinsic synchronization no longer inherently pins a virtual thread to its carrier. As a virtual thread freezes, HotSpot moves its lightweight lock-stack object references into continuation stack-chunk state and restores them when it mounts again. Inflated monitor ownership also has to follow the logical Java-thread identity, rather than treating one carrier as the permanent owner.

<figure>
<a href="/images/courses/jvm/virtual-thread-lockstack.svg" aria-label="Open virtual-thread LockStack transfer diagram"><img src="/images/courses/jvm/virtual-thread-lockstack.svg" alt="A virtual thread carries its lightweight lock references from Carrier A into its continuation stack chunk on freeze, then restores the references on Carrier B at thaw. Inflated ownership follows Java-thread identity." width="900" height="530" /></a>
<figcaption>When a virtual thread changes carriers, its monitor ownership must remain with the virtual thread. The lock-stack movement is an implementation detail that enables the JDK 25 behavior.</figcaption>
</figure>

<aside class="lesson-callout" data-kind="important" aria-label="Important">
<p class="callout-label">Important</p>
<p>On JDK 25, ordinary <code>synchronized</code> code does not inherently pin a virtual thread. A virtual thread can usually unmount while blocked inside an intrinsic monitor region, while continuing to hold the monitor. That means the carrier can run other work, but another thread still cannot enter the protected region until the virtual thread releases the monitor. Native-frame interactions can still prevent unmounting.</p>
</aside>

This changes the carrier story, not the lock's mutual-exclusion rule. If a virtual thread blocks while holding a monitor, the monitor remains owned and can still limit other work that needs it. Releasing the carrier does not release the monitor.

## Diagnose contention from evidence

The useful performance question is not “does this code use `synchronized`?” Uncontended intrinsic synchronization is designed to be cheap. The costs to investigate are contention and its consequences: queueing, spinning, parking, wakeups, cache-coherence traffic on shared state, and the amount of useful work protected by the critical section.

<figure>
<a href="/images/courses/jvm/synchronized-cost-model.svg" aria-label="Open synchronization cost model"><img src="/images/courses/jvm/synchronized-cost-model.svg" alt="Uncontended synchronization usually follows a lightweight path. As contention grows, queueing, spinning, parking, wakeups, cache coherence and critical-section length can drive latency and throughput cost." width="900" height="500" /></a>
<figcaption>The keyword alone does not identify the bottleneck; shared hot locks and the work around them do.</figcaption>
</figure>

A production investigation should connect evidence to the question being asked:

1. Capture repeated thread dumps during the slow interval, for example with `jcmd <pid> Thread.print -l`. Look for threads blocked entering monitors, the monitor owner, and repeated stacks pointing to the same lock-protected path. A `BLOCKED` thread is waiting to enter; a thread in `Object.wait()` has released the monitor and waits for notification or another wake condition. One dump is a snapshot, not a contention rate.
2. Use Java Flight Recorder monitor events or platform monitoring APIs to determine whether monitor-enter waits recur and how long they last. Event thresholds and recording settings affect what is recorded, so absence of an event is not proof that no synchronization cost exists.
3. Correlate contention with request latency, throughput, CPU, and the protected operation. A long wait can point to an oversized critical section or a slow call made while holding a lock; a hot lock with many short waits can indicate shared-state serialization.
4. Change lock scope or coordination only after you understand the invariant being protected. Replacing `synchronized` with another lock does not remove serialization on the same shared resource.

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>Thread dumps and monitor-contention events answer different questions. Dumps show who is blocked and where at a moment in time; JFR or management data can show repeated waits over an interval. Use both with application latency and throughput before concluding that a monitor is the cause.</p>
</aside>

An inflated monitor in a dump or event is useful evidence about representation or contention, but it does not by itself prove that the monitor is the application's dominant cost. Workload, lock frequency, queue length, and critical-section duration determine the impact.

## Check your reasoning

<details class="lesson-check">
<summary>Why does a thread in `wait()` not immediately resume inside the synchronized block after another thread calls `notify()`?</summary>
<p>Notification makes the waiter eligible to continue, but it does not hand the monitor to that thread. The waiter must compete to reacquire the monitor, and it can return from <code>wait()</code> only after reacquiring it. Another thread may acquire the monitor first, so condition checks belong in a loop.</p>
</details>

<details class="lesson-check">
<summary>A virtual thread blocks in a JDK 25 synchronized region and unmounts. Can another thread enter the same monitor because the carrier was released?</summary>
<p>No. Unmounting releases the carrier execution resource; it does not release the monitor. The virtual thread remains the logical owner until it exits or waits on that monitor, so contenders still cannot enter.</p>
</details>

<details class="lesson-check">
<summary>A profiler reports monitor inflation. What can you conclude?</summary>
<p>HotSpot used an <code>ObjectMonitor</code> representation for the monitor. Inflation can follow contention or a need for richer monitor operations such as <code>wait()</code>; the observation alone does not establish a throughput problem. Correlate repeated wait evidence with the application's slow path.</p>
</details>

## The complete path

<figure>
<a href="/images/courses/jvm/synchronized-complete.svg" aria-label="Open complete synchronized monitor lifecycle"><img src="/images/courses/jvm/synchronized-complete.svg" alt="A synchronized call follows Java monitor semantics through block bytecode or synchronized method invocation, usually taking the lightweight Mark Word and LockStack path, possibly inflating to ObjectMonitor for richer state, then releasing or later deflating." width="900" height="560" /></a>
<figcaption>The Java contract stays stable while HotSpot changes the representation to meet the runtime's needs.</figcaption>
</figure>

For JDK 25 HotSpot, remember the division of responsibilities: Java defines monitor behavior; the Mark Word carries a lock-state encoding; the LockStack tracks lightweight ownership; and an `ObjectMonitor` supplies richer state for operations that need it. Virtual-thread lock state follows the virtual thread across carrier changes, while monitor ownership continues to enforce mutual exclusion.

The next lesson turns to explicit synchronizers: **`ReentrantLock`, AQS, and `LockSupport.park()`**. That mechanism uses Java-level queueing and parking to build lock behavior, which gives us a useful comparison with HotSpot's intrinsic-monitor machinery.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Based on Daily JVM Byte #20 and its reviewed draft requirements. Diagrams and fast-path sequences are explanatory, not captured execution traces; no benchmark or forced inflation experiment was run. The Java monitor contract follows the Java SE 25 specifications. Header states, LockStack bookkeeping, inflation, deflation, and continuation integration describe HotSpot on JDK 25 and may vary by release, build, platform, or configuration. The exact low-bit illustration is the standard JDK 25 HotSpot locking encoding, not a Java guarantee.</p>
<ul>
<li><a href="https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.19">Java Language Specification, synchronized statements</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.3.6">Java Language Specification, synchronized methods</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.11.10">Java Virtual Machine Specification, method invocation synchronization</a></li>
<li><a href="https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.monitorenter">Java Virtual Machine Specification, <code>monitorenter</code> and <code>monitorexit</code></a></li>
<li><a href="https://openjdk.org/jeps/491">JEP 491: Synchronize Virtual Threads without Pinning</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/hotspot/share/oops/markWord.hpp">OpenJDK 25 update source, Mark Word lock-state encodings</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/hotspot/share/runtime/synchronizer.cpp">OpenJDK 25 update source, lightweight locking and monitor inflation/deflation</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/hotspot/share/runtime/objectMonitor.hpp">OpenJDK 25 update source, ObjectMonitor state</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadInfo.html">Java SE 25 ThreadInfo management API</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/MonitorInfo.html">Java SE 25 MonitorInfo management API</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/hotspot/share/jfr/metadata/metadata.xml">OpenJDK 25u JFR event metadata, including JavaMonitorEnter</a></li>
</ul>
</details>
