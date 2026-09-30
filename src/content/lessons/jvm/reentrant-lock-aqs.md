---
title: ReentrantLock, AQS, and parking
summary: Follow an explicit Java lock from its atomic fast path through AQS queueing, conditions, parking, virtual threads, and contention diagnosis.
course: jvm
lessonSlug: reentrant-lock-aqs
module: Threads and Synchronization
order: 210
sourceByte: byte-021
draft: false
prerequisites: [synchronization-internals]
jdk: Java SE 25 · OpenJDK 25 implementation notes
---

You already know the monitor behind `synchronized`. Now imagine an application that must give up a lock after a short deadline, stop waiting when interrupted, or wait for one of several different conditions. Intrinsic monitors do not expose those choices directly.

`ReentrantLock` keeps mutual exclusion, but gives the application a richer API: immediate and timed attempts, interruptible acquisition, a selectable fairness policy, separate conditions, and some queue/ownership inspection methods.

<figure>
<a href="/images/courses/jvm/monitor-vs-aqs.svg" aria-label="Open monitor and AQS comparison"><img src="/images/courses/jvm/monitor-vs-aqs.svg" alt="Synchronized uses JVM monitor semantics and HotSpot monitor machinery. ReentrantLock is a Java library lock built on AQS state and queues, with LockSupport parking." width="900" height="470" /></a>
<figcaption>Both forms provide mutual exclusion. Their coordination machinery and the choices exposed to application code differ.</figcaption>
</figure>

<mark>`synchronized` is a JVM monitor abstraction; `ReentrantLock` is a Java-library synchronizer built primarily on AQS.</mark>

## When an explicit lock helps

The simplest case is still a monitor:

```java
synchronized (account) {
    account.update();
}
```

When the coordination policy is part of the problem, an explicit lock has operations that a monitor does not expose:

```java
if (lock.tryLock()) { ... }                  // do not wait
if (lock.tryLock(100, MILLISECONDS)) { ... } // wait up to a bound
lock.lockInterruptibly();                    // cancellation can stop acquisition
```

The last form is useful when a task's cancellation should include time spent waiting for a lock. Code must still release an acquired lock on every exit path:

```java
lock.lock();
try {
    account.update();
} finally {
    lock.unlock();
}
```

The `try`/`finally` is essential. Unlike leaving a synchronized block, returning from a method does not automatically unlock a `ReentrantLock`.

Conditions are another reason to choose this API. One lock can create multiple `Condition` objects, such as `notEmpty` and `notFull` for a bounded buffer. That separates wait reasons that would share one object's monitor wait set when using `wait()` and `notify()`.

Some inspection methods report whether the current thread owns the lock, its reentrant hold count, or whether threads appear to be queued. These are observations for monitoring and diagnostics; they are not a safe substitute for acquiring the lock or coordinating application decisions.

<aside class="lesson-callout" data-kind="key-idea" aria-label="Key idea">
<p class="callout-label">Key idea</p>
<p>Choose <code>ReentrantLock</code> when timed, interruptible, fair, or condition-based behavior helps express the program's coordination policy. The class name alone does not promise faster locking.</p>
</aside>

## AQS separates policy from queue machinery

`ReentrantLock` is built on **AbstractQueuedSynchronizer (AQS)**, a reusable framework in `java.util.concurrent`. AQS supplies atomic state operations and queueing machinery. A subclass supplies the rules for what that state means and when an acquisition succeeds. AQS is also used by other synchronizers; it is not a synonym for `ReentrantLock`.

For an exclusive lock, keep three ideas separate:

- **State** is an integer changed atomically. AQS does not give it one universal meaning. The subclass defines the meaning.
- **Owner** is the thread that currently has exclusive access. AQS's ownable synchronizer support lets an exclusive synchronizer record that thread.
- **Synchronization queue** holds threads that have not acquired and may need to wait. Queue position is not a universal promise of strict first-in-first-out acquisition.

For `ReentrantLock`, state represents the hold count: zero means unlocked; a positive value counts how many times the owner has acquired it. The exclusive owner is recorded separately. <mark>AQS defines no universal meaning for state; the synchronizer subclass does.</mark>

<figure>
<a href="/images/courses/jvm/aqs-overview.svg" aria-label="Open AQS overview"><img src="/images/courses/jvm/aqs-overview.svg" alt="A synchronizer subclass defines the meaning of atomic AQS state and acquisition policy. AQS supplies a synchronization queue and park/unpark support; exclusive ownership is separate from state." width="900" height="500" /></a>
<figcaption>AQS provides reusable coordination machinery; the concrete synchronizer defines the state and acquisition policy.</figcaption>
</figure>

## The free-lock fast path

When the lock is free, `lock()` first tries to acquire without queueing. Conceptually, the non-fair path reads state zero, atomically changes it from zero to one, then records the current thread as owner:

```text
Thread A → attempt acquisition
         → state is 0
         → compare-and-set 0 → 1 succeeds
         → record A as exclusive owner
         → enter critical section
```

The **compare-and-set (CAS)** operation succeeds only if state still has the expected value. If another thread wins the race first, this attempt fails and the caller follows a contended path. That atomic transition arbitrates the race; assigning the owner is part of the synchronizer's protocol.

<figure>
<a href="/images/courses/jvm/reentrantlock-fast-path.svg" aria-label="Open ReentrantLock fast path"><img src="/images/courses/jvm/reentrantlock-fast-path.svg" alt="An unlocked state is claimed with an atomic state transition from zero to one; the winner records itself as owner and enters, while a failed CAS checks reentrancy or contention policy." width="900" height="440" /></a>
<figcaption>The uncontended path is an atomic state claim plus owner bookkeeping. This is a conceptual sequence, not a fixed instruction trace.</figcaption>
</figure>

## Reentrancy is a hold count

If the current owner calls `lock()` again, the lock does not deadlock itself. `ReentrantLock` recognizes the same owner and increments the hold count. Each matching `unlock()` decrements it. The lock becomes available to another thread only when the count reaches zero; that final release clears ownership and can wake an eligible waiter.

```text
lock()   state 0 → 1, owner = A
lock()   state 1 → 2, owner = A
unlock() state 2 → 1, owner = A   (still held)
unlock() state 1 → 0, owner cleared (now free)
```

This is the lock's logical model. The implementation checks ownership before allowing the count to grow and rejects an `unlock()` by a non-owner.

<figure>
<a href="/images/courses/jvm/reentrantlock-reentrancy.svg" aria-label="Open reentrancy hold count diagram"><img src="/images/courses/jvm/reentrantlock-reentrancy.svg" alt="Thread A acquires twice so the hold count is two. Its first unlock reduces the count to one and retains ownership; its second reduces to zero and releases the lock." width="900" height="430" /></a>
<figcaption>Ownership lasts until every reentrant acquisition has a matching release.</figcaption>
</figure>

## What happens when another thread arrives

Suppose A holds the lock and B calls `lock()`. B cannot claim state, so AQS places B in a synchronization-queue node: this is Java library queueing, not HotSpot `ObjectMonitor` contention. AQS acquisition repeatedly checks whether B is now eligible and whether the subclass's acquire rule succeeds. If it cannot proceed, B may park instead of burning CPU in a tight loop. When the lock is released, an eligible queued thread is unparked and retries the acquisition protocol.

<figure>
<a href="/images/courses/jvm/aqs-contention-queue.svg" aria-label="Open AQS contention queue diagram"><img src="/images/courses/jvm/aqs-contention-queue.svg" alt="Thread A owns the lock. Threads B and C wait in AQS synchronization nodes; release makes a waiter eligible, unparks it, and it retries acquisition." width="900" height="470" /></a>
<figcaption>The queue records waiting acquisition attempts. Waking a node lets it compete under the lock's policy; it does not hand the lock to that thread.</figcaption>
</figure>

An AQS queue is explicit, but do not read it as a promise that every synchronizer grants access in strict arrival order. The concrete synchronizer chooses its policy; cancellation, wakeups, scheduling, and retry races also matter. `ReentrantLock` offers fair and non-fair policies, discussed below.

## Parking provides a place to wait

`LockSupport.park()` and `unpark(thread)` are low-level building blocks used by synchronizers. Each thread has at most one permit. `unpark` makes that permit available; repeated calls do not stack up multiple permits. If the permit is already available, a later `park()` consumes it and returns. Otherwise, `park()` may suspend the thread until an unpark, an interrupt, or another permitted return condition.

That one-bit permit makes the race between “about to park” and `unpark` safe: an unpark that arrives first is remembered for the next park. But park is not a condition variable and it does not tell the caller that its desired condition became true.

<figure>
<a href="/images/courses/jvm/aqs-park.svg" aria-label="Open LockSupport permit diagram"><img src="/images/courses/jvm/aqs-park.svg" alt="LockSupport gives a thread a single permit. Unpark sets it if absent. Park consumes an available permit or waits, then caller checks its condition again." width="900" height="420" /></a>
<figcaption>The permit prevents a lost wakeup in the basic park/unpark race; it is not an ownership token.</figcaption>
</figure>

`park()` may also return spuriously or because the thread was interrupted. Correct synchronizer code therefore loops and rechecks the lock state or other condition after every return. <mark>`unpark()` makes progress possible; it does not transfer lock ownership.</mark> The thread still has to run, retry, and win whatever atomic acquisition the lock requires.

This differs from `Object.wait()` and `notify()`. Calling `wait()` requires owning that object's intrinsic monitor, releases that monitor while waiting, and reacquires it before returning. `LockSupport.park()` requires no intrinsic-monitor ownership and does not automatically release any lock the thread holds. AQS or a `Condition` explicitly arranges the lock state around parking.

<figure>
<a href="/images/courses/jvm/wait-vs-park.svg" aria-label="Open wait versus park comparison"><img src="/images/courses/jvm/wait-vs-park.svg" alt="Object.wait requires and releases the object's monitor, then reacquires it before return. LockSupport.park has no monitor ownership rule and releases no lock automatically." width="900" height="490" /></a>
<figcaption>The similar-sounding wait operations have different ownership and release rules.</figcaption>
</figure>

## Conditions create separate wait queues

A `Condition` associates a wait queue with a `Lock`. A lock may have multiple conditions for different predicates. For example, a bounded buffer can keep consumers on `notEmpty` and producers on `notFull` rather than waking every kind of waiter for either event.

Calling `await()` requires the caller to hold the associated lock. It atomically releases that lock as it joins the condition queue, then parks until signalled, interrupted, timed out, or otherwise eligible. `signal()` selects a condition waiter and transfers it toward the lock's synchronization queue. It does not grant the lock. The awakened thread must reacquire the lock before `await()` returns, and the program must check its predicate again in a loop.

<figure>
<a href="/images/courses/jvm/aqs-condition-queues.svg" aria-label="Open multiple condition queues diagram"><img src="/images/courses/jvm/aqs-condition-queues.svg" alt="One ReentrantLock has separate notEmpty and notFull condition queues. Signalled waiters move toward the shared AQS synchronization queue to reacquire the lock." width="900" height="490" /></a>
<figcaption>Conditions separate reasons for waiting; all signalled threads still have to reacquire their shared lock.</figcaption>
</figure>

<figure>
<a href="/images/courses/jvm/condition-await-signal.svg" aria-label="Open Condition await and signal sequence"><img src="/images/courses/jvm/condition-await-signal.svg" alt="A thread holding the lock checks a predicate, calls await, releases the lock and waits in a condition queue. Another owner changes the predicate and signals. The waiter joins the synchronization queue, reacquires, then returns from await and checks again." width="900" height="520" /></a>
<figcaption>Signalling moves a waiter toward being able to reacquire; it does not make `await()` return while another thread owns the lock.</figcaption>
</figure>

```java
lock.lock();
try {
    while (queue.isEmpty()) {
        notEmpty.await();
    }
    return queue.remove();
} finally {
    lock.unlock();
}
```

Use a `while`, not an `if`: a wakeup does not prove the predicate is true when this thread reacquires. Another thread may have changed the state first, or the wait may return due to interruption or timeout.

## Fairness is an acquisition policy

The default `new ReentrantLock()` is non-fair. When it becomes free, a newly arriving thread may acquire ahead of one that has waited longer: this is **barging**. A fair lock favors the longest-waiting eligible thread under contention, which can reduce starvation risk but commonly lowers throughput. Fairness governs lock acquisition; it does not make the operating-system or virtual-thread scheduler fair.

There is a deliberate API wrinkle: untimed `tryLock()` may barge even when the lock was constructed as fair. It answers whether the lock is available now. The timed `tryLock(timeout, unit)` honors the fair policy when using a fair lock.

<figure>
<a href="/images/courses/jvm/fair-vs-nonfair-lock.svg" aria-label="Open fair and non-fair lock comparison"><img src="/images/courses/jvm/fair-vs-nonfair-lock.svg" alt="A fair lock gives priority to the longest-waiting eligible thread. A non-fair lock may let a new thread barge when the lock becomes free. Untimed tryLock can barge on either lock." width="900" height="470" /></a>
<figcaption>Fairness changes who is favored when the lock is contended, with a throughput trade-off and a notable untimed-tryLock exception.</figcaption>
</figure>

Fairness does not guarantee fair scheduling, and an untimed `tryLock()` can still barge on a fair lock. Select fairness for a demonstrated acquisition-policy need, then measure its effect under the workload.

## What parking means for virtual threads

On JDK 25, `LockSupport.park()` can suspend a virtual thread through the virtual-thread runtime. In the ordinary case the virtual thread is unmounted and its carrier becomes available to run other work; it is not necessary to keep one operating-system thread asleep for each parked virtual thread. When `unpark` makes it ready, the scheduler can mount it again. It resumes AQS's acquisition loop and still has to reacquire the lock.

<figure>
<a href="/images/courses/jvm/aqs-virtual-thread-park.svg" aria-label="Open virtual-thread parking flow"><img src="/images/courses/jvm/aqs-virtual-thread-park.svg" alt="A virtual thread waiting in the AQS queue parks and unmounts from Carrier A, which can run other work. Unpark makes the virtual thread schedulable; it later mounts on a carrier and retries AQS acquisition." width="900" height="470" /></a>
<figcaption>Parking can free the carrier while the virtual thread waits. The lock's ownership and acquisition protocol still apply after it resumes.</figcaption>
</figure>

This is a runtime behavior, not a different lock contract: the virtual thread remains a waiter until it successfully reacquires. Native calls and other pinning constraints can affect whether a virtual thread unmounts, so “parked” should not be generalized into “every wait always frees a carrier.”

## Diagnose the wait path

Intrinsic monitor entry contention often appears as `BLOCKED`. Threads waiting through AQS and `LockSupport` often appear as `WAITING` or `TIMED_WAITING`, with stack frames mentioning `park`, `LockSupport`, or an AQS acquire method. Conditions can also park while the thread is outside the lock's critical section.

These patterns help you choose where to look, but a thread state is only a snapshot. It does not identify the lock policy, prove that the wait caused user-visible latency, or measure how often the thread waited. Capture repeated thread dumps during the slow interval, inspect the stack and lock owner, then correlate with JFR or application latency/throughput data. For AQS, look for the application frame above the acquisition or condition wait and determine how long the protected operation takes.

<aside class="lesson-callout" data-kind="production" aria-label="Production note">
<p class="callout-label">Production note</p>
<p>Queued threads, parked stacks, or a fair-lock setting do not by themselves prove the lock is your bottleneck. Contention, critical-section duration, wakeup traffic, and the surrounding workload drive the cost. Use repeated evidence and latency/throughput measurements before changing lock policy.</p>
</aside>

Use `ReentrantLock` because its semantics fit the coordination problem. It may use a quick atomic path when uncontended, but under contention it still serializes access and incurs queueing, scheduling, wakeup, and cache-coherence costs. No lock API is a blanket performance upgrade.

## Check your reasoning

<details class="lesson-check">
<summary>If `unpark(thread)` runs just before that thread calls `park()`, can the wakeup be lost?</summary>
<p>For a started thread, the single permit remains available. The next park consumes it and returns. There is only one permit, so repeated unpark calls do not accumulate.</p>
</details>

<details class="lesson-check">
<summary>Thread A signals a waiter on a Condition. Does that waiter own the lock when signal returns?</summary>
<p>No. Signal transfers an eligible waiter toward the lock's synchronization queue. It must run, reacquire the lock, and check the condition predicate before continuing.</p>
</details>

<details class="lesson-check">
<summary>Does a fair ReentrantLock guarantee the thread that arrived first always acquires next?</summary>
<p>It favors the longest-waiting eligible thread under contention, but does not control scheduler fairness; untimed <code>tryLock()</code> can barge. Fairness is an acquisition policy, not a universal ordering guarantee.</p>
</details>

<details class="lesson-check">
<summary>A virtual thread parks while queued for an AQS lock. Does it stop holding a lock it already owns?</summary>
<p>No. Park itself does not release a lock. AQS arranges acquisition parking when the thread does not own the requested lock. A Condition's <code>await()</code> separately releases its associated lock as part of its contract.</p>
</details>

## Close the synchronization block

The two lock families now have a useful boundary. Intrinsic monitors are part of JVM monitor semantics, with HotSpot managing their representation. `ReentrantLock` is a library synchronizer: AQS contributes atomic state and waiting queues, while `LockSupport` provides low-level parking. Conditions add a second kind of queue, and fairness selects an acquisition policy.

<figure>
<a href="/images/courses/jvm/aqs-complete.svg" aria-label="Open AQS acquisition lifecycle"><img src="/images/courses/jvm/aqs-complete.svg" alt="A ReentrantLock acquisition tries an atomic AQS state change, handles same-owner reentrancy, queues a contending waiter and parks as needed, then retries after release and unlocks when the hold count reaches zero." width="900" height="500" /></a>
<figcaption>From API choice to release, each layer has a distinct job: lock policy, AQS state and queueing, and park/unpark waiting.</figcaption>
</figure>

The Threads and Synchronization block is complete. Next we return to the heap and begin **Garbage Collection foundations**: how collectors find live objects, choose what to reclaim, and manage memory over an object's lifetime.

<details class="lesson-sources">
<summary>Sources and implementation boundaries</summary>
<p>Based on Daily JVM Byte #21 and its reviewed lesson requirements. The diagrams and acquisition sequences are explanatory; no contention benchmark or forced thread-state experiment was run. Public API behavior is based on Java SE 25 documentation. AQS internals and virtual-thread parking notes describe the OpenJDK 25 implementation and may vary across JDK builds. Thread state is diagnostic evidence, not a complete performance diagnosis.</p>
<ul>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html">Java SE 25 API: ReentrantLock</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html">Java SE 25 API: AbstractQueuedSynchronizer</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html">Java SE 25 API: Condition</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/LockSupport.html">Java SE 25 API: LockSupport</a></li>
<li><a href="https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html">Java SE 25 API: Thread.State</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/java.base/share/classes/java/util/concurrent/locks/ReentrantLock.java">OpenJDK 25u source: ReentrantLock policy and hold count</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java">OpenJDK 25u source: AQS state, acquisition queue, and conditions</a></li>
<li><a href="https://github.com/openjdk/jdk25u/blob/master/src/java.base/share/classes/java/util/concurrent/locks/LockSupport.java">OpenJDK 25u source: LockSupport parking integration</a></li>
</ul>
</details>
