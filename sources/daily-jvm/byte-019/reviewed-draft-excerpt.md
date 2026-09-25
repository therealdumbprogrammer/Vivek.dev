# Originating reviewed draft (retrieved excerpt)

The conversation reader limits a message to 20,000 characters. This is the available prefix, not the full draft. The final reasoning checks and ending were truncated; the user's explicit retained requirements govern integration.

Byte #19 is strong and the JDK 25 pinning correction is especially important. I’d preserve the structure but tighten four things:

- Separate **platform-thread identity** from **carrier execution resource** very explicitly.
- Be precise that virtual-thread stacks use **heap-resident stack chunks as part of HotSpot continuation machinery**, not that every suspended stack is one simple object.
- Keep the JEP 491 correction prominent: **ordinary `synchronized` no longer inherently pins virtual threads on JDK 25**.
- Add one explicit production warning: virtual threads scale waiting, but they do not remove bottlenecks such as DB pools, rate limits, or external service capacity.

## Draft — Lesson 19: Platform threads vs virtual threads in JDK 25

```markdown id="4a4x4p"
---
title: Platform threads vs virtual threads in JDK 25
summary: Understand the difference between OS-backed platform threads and Java-managed virtual threads, how carriers and mounting work, and what happens to a virtual thread's stack when it blocks.
course: jvm
lessonSlug: platform-vs-virtual-threads
module: Threads and Synchronization
order: 190
sourceByte: byte-019
draft: false
prerequisites:
  - thread-local-handshakes
jdk: JDK 25 · virtual threads and continuations
---

So far, when we said:

```text
Java thread
```

we mostly treated it as one execution entity.

That model is no longer sufficient in modern Java.

In JDK 25, the important distinction is:

```text
Platform thread

Java Thread
    │
    ▼
OS Thread
```

versus:

```text
Virtual thread

Java VirtualThread
      │
      │ mounted while running
      ▼
Carrier platform thread
      │
      ▼
OS Thread
```

<figure>
<a href="/images/courses/jvm/platform-vs-virtual-overview.svg" aria-label="Open platform versus virtual thread overview">
<img src="/images/courses/jvm/platform-vs-virtual-overview.svg"
     alt="A platform thread maps to an operating-system thread, while a virtual thread is mounted onto a carrier platform thread only while it executes."
     width="840" height="500" />
</a>
<figcaption>Virtual threads separate Java thread identity from permanent ownership of an OS thread.</figcaption>
</figure>

<mark>A virtual thread is a Java thread, but it does not own one OS thread for its entire lifetime.</mark>

## Platform threads: the traditional model

A platform thread maps closely to an operating-system thread.

Conceptually:

```text
Java Thread
    │
    ▼
Platform Thread
    │
    ▼
OS Thread
    │
    ▼
CPU scheduling
```

That OS thread remains associated with the Java platform thread throughout its lifetime.

This gives us the familiar resource model:

```text
one active Java platform thread
        │
        ├── one OS thread
        ├── native stack
        ├── kernel scheduling state
        └── operating-system resources
```

<figure>
<a href="/images/courses/jvm/platform-thread-resources.svg" aria-label="Open platform-thread resource model">
<img src="/images/courses/jvm/platform-thread-resources.svg"
     alt="A Java platform thread is associated with an OS thread, native stack, kernel scheduling state, and CPU scheduling."
     width="820" height="470" />
</a>
<figcaption>Platform-thread scalability is tied closely to operating-system thread resources.</figcaption>
</figure>

For modest thread counts, this is perfectly reasonable.

The problem appears when concurrency becomes very large.

## Blocking traditionally consumes an OS thread

Suppose a server uses one platform thread per request.

```text
Request 1 ─► Platform Thread 1 ─► OS Thread 1
Request 2 ─► Platform Thread 2 ─► OS Thread 2
Request 3 ─► Platform Thread 3 ─► OS Thread 3
```

Now Request 1 performs:

```java
socket.read(...);
```

and waits.

Conceptually:

```text
Request
   │
   ▼
Java platform thread
   │
   ▼
OS thread
   │
   ▼
blocking I/O
   │
   ▼
waiting...
```

Even though the request is doing no useful CPU work, the OS thread remains associated with that Java thread.

Scale this to:

```text
10,000 waiting requests
```

and the model trends toward:

```text
10,000 Java threads
≈
10,000 OS threads
```

That brings costs such as:

```text
native stack reservations
kernel scheduler overhead
context switching
OS resource limits
```

The programming model is simple.

The resource model becomes expensive.

## Virtual threads preserve the simple programming model

Virtual threads attack this problem by separating:

```text
Java thread identity
```

from:

```text
OS thread ownership
```

Suppose we create many virtual threads:

```text
V1
V2
V3
V4
V5
...
```

They do not each permanently own an OS thread.

Instead, the JDK schedules runnable virtual threads onto a smaller set of **carrier platform threads**.

```text
                 Virtual Threads

V1 ─────┐
V2 ─────┤
V3 ─────┤
V4 ─────┤
V5 ─────┘
        │
        ▼
   JDK scheduler
     /       \
    ▼         ▼
Carrier 1   Carrier 2
    │          │
    ▼          ▼
OS Thread 1 OS Thread 2
```

<figure>
<a href="/images/courses/jvm/virtual-thread-carriers.svg" aria-label="Open virtual threads and carrier threads">
<img src="/images/courses/jvm/virtual-thread-carriers.svg"
     alt="Many virtual threads are scheduled over a smaller set of carrier platform threads, each backed by an OS thread."
     width="840" height="500" />
</a>
<figcaption>Carrier threads are execution resources shared by many virtual threads over time.</figcaption>
</figure>

## Mounting: when a virtual thread actually executes

Suppose:

```text
V1
```

is selected to run.

Conceptually:

```text
V1
 │
 │ mount
 ▼
Carrier 1
 │
 ▼
OS Thread
 │
 ▼
CPU
```

During that period, the carrier executes V1's Java code.

Later:

```text
V1 stops running
```

and the same carrier may execute:

```text
V7
```

instead.

```text
time 1

V1
 ↓
Carrier 1


time 2

V7
 ↓
Carrier 1
```

<figure>
<a href="/images/courses/jvm/virtual-thread-mounting.svg" aria-label="Open virtual-thread mounting">
<img src="/images/courses/jvm/virtual-thread-mounting.svg"
     alt="At one moment virtual thread V1 is mounted on carrier 1. Later V1 is no longer running and carrier 1 executes virtual thread V7."
     width="820" height="470" />
</a>
<figcaption>A carrier is not the identity of a virtual thread; it is a reusable execution resource.</figcaption>
</figure>

That distinction is fundamental:

<mark>The virtual thread owns its Java execution identity; the carrier only provides CPU execution while the virtual thread is mounted.</mark>

## Blocking can free the carrier

Now suppose V1 executes:

```java
socket.read(...);
```

and the operation cannot currently complete.

For blocking operations integrated with the virtual-thread runtime, the execution model can be:

```text
V1 running
   │
   ▼
Carrier 1
   │
   ▼
blocking operation
   │
   ▼
V1 cannot progress
   │
   ▼
unmount V1
```

Now:

```text
V1
```

is waiting,

but:

```text
Carrier 1
```

is free.

So the scheduler can run:

```text
V2
```

on the same carrier.

```text
V1 ───── waiting

V2
 ↓ mount
Carrier 1
 ↓
CPU
```

<figure>
<a href="/images/courses/jvm/virtual-thread-unmount-blocking.svg" aria-label="Open virtual-thread blocking and unmounting">
<img src="/images/courses/jvm/virtual-thread-unmount-blocking.svg"
     alt="Virtual thread V1 blocks on I/O and unmounts from carrier 1. V1 remains waiting while carrier 1 becomes available to execute V2."
     width="850" height="520" />
</a>
<figcaption>Unmounting lets blocked virtual threads stop consuming a carrier while they wait.</figcaption>
</figure>

This is the central scalability mechanism.

## A virtual thread does not return to the same carrier

Later the I/O completes.

```text
I/O ready
   │
   ▼
V1 becomes runnable
   │
   ▼
scheduler
   │
   ▼
available carrier
```

Perhaps:

```text
Carrier 2
```

is free first.

Then:

```text
V1
 ↓
Carrier 2
```

There is no requirement that V1 resume on Carrier 1.

This means:

```text
virtual-thread identity
```

must be independent from:

```text
carrier identity
```

The carrier is just where the virtual thread happens to execute at that moment.

## So where does the virtual thread's stack go?

This is where virtual threads differ fundamentally from platform threads.

A platform thread has the traditional native-thread stack model:

```text
OS Thread
   │
   ▼
native stack

┌───────────────┐
│ frame C       │
├───────────────┤
│ frame B       │
├───────────────┤
│ frame A       │
└───────────────┘
```

If every virtual thread needed its own permanently reserved large native stack, then:

```text
1,000,000 virtual threads
```

would still imply an enormous native-memory footprint.

That would defeat much of the purpose.

Instead, HotSpot uses continuation-backed stack storage that can be represented in **stack chunks** managed in the Java heap.

Conceptually:

```text
VirtualThread V1

Heap
┌────────────────────────┐
│ StackChunk             │
│                        │
│  Java frame state      │
│  Java frame state      │
│  Java frame state      │
└────────────────────────┘
```

<figure>
<a href="/images/courses/jvm/virtual-thread-stack-chunks.svg" aria-label="Open virtual-thread stack chunks">
<img src="/images/courses/jvm/virtual-thread-stack-chunks.svg"
     alt="A virtual thread has continuation-backed Java execution state represented using stack chunks managed in the Java heap rather than a permanently reserved native thread stack."
     width="830" height="500" />
</a>
<figcaption>Virtual-thread stack state can outlive any particular carrier thread.</figcaption>
</figure>

Do not interpret this as:

```text
one virtual thread
=
exactly one StackChunk object forever
```

The actual implementation can use multiple chunks and manage them dynamically.

The important architectural point is:

> **Suspended virtual-thread Java stack state is not tied permanently to one native OS-thread stack.**

## Continuations provide the resumable execution model

A virtual thread behaves conceptually like a resumable computation:

```text
run
 │
 ▼
run
 │
 ▼
block
 │
 ▼
suspend
 │
 │ execution state preserved
 ▼
wait
 │
 ▼
resume
 │
 ▼
run
```

HotSpot/JDK continuation machinery provides the underlying suspend/resume capability.

A useful implementation-level model is:

```text
VirtualThread
      │
      ▼
Continuation
      │
      ▼
stack chunks / execution state
```

<figure>
<a href="/images/courses/jvm/continuation-model.svg" aria-label="Open virtual-thread continuation model">
<img src="/images/courses/jvm/continuation-model.svg"
     alt="A VirtualThread is backed conceptually by continuation machinery that preserves stack chunks and execution state across suspension and later resumption."
     width="820" height="470" />
</a>
<figcaption>Continuations make it possible to suspend Java execution independently of the carrier currently executing it.</figcaption>
</figure>

Application code normally does not manipulate this continuation machinery directly.

You still program against:

```java
Thread
```

and blocking Java APIs.

## Virtual threads change stack-memory economics

With platform threads:

```text
one thread
   │
   ▼
one OS thread
   │
   ▼
native stack resources
```

With virtual threads:

```text
virtual thread
   │
   ▼
heap-managed suspended execution state

while actually running
   │
   ▼
carrier OS thread
```

That changes the scalability model dramatically.

Conceptually:

```text
PLATFORM THREAD MODEL

100,000 Java threads
≈
100,000 OS threads
≈
100,000 native stacks
```

versus:

```text
VIRTUAL THREAD MODEL

100,000 virtual threads
+
far fewer carrier OS threads
+
heap-managed suspended stack state
```

<mark>Millions of virtual threads do not imply millions of permanently reserved traditional native thread stacks.</mark>

This connects directly back to our JVM process-memory lesson.

## Virtual threads improve concurrency, not CPU capacity

Now suppose the machine has:

```text
8 CPU cores
```

and the application creates:

```text
100,000 CPU-bound virtual threads
```

How many can execute CPU instructions simultaneously?

Approximately:

```text
the number the hardware can actually run
```

not:

```text
100,000
```

Virtual threads do not manufacture processors.

```text
100,000 runnable CPU tasks
          │
          ▼
carrier threads
          │
          ▼
8 cores
```

<figure>
<a href="/images/courses/jvm/virtual-threads-cpu-bound.svg" aria-label="Open virtual threads and CPU-bound work">
<img src="/images/courses/jvm/virtual-threads-cpu-bound.svg"
     alt="A very large number of runnable CPU-bound virtual threads still funnel through a limited number of carriers and eight physical CPU cores."
     width="820" height="470" />
</a>
<figcaption>Virtual threads increase concurrency scalability, not hardware parallelism.</figcaption>
</figure>

Their strongest benefit appears when tasks spend substantial time **waiting**:

```text
HTTP calls
database calls
socket I/O
queues
remote services
other blocking operations
```

The scheduler can use carriers for work that is actually runnable instead of dedicating OS threads to idle waits.

## Thread-per-task becomes practical again

Historically, scalable servers often avoided:

```text
one blocking thread per request
```

because thread counts would become too large.

That encouraged architectures based on:

```text
callbacks
reactive chains
async state machines
```

Virtual threads make straightforward code practical at much higher concurrency:

```java
handleRequest() {
    var customer = customerService.load();
    var order = orderService.load();
    return buildResponse(customer, order);
}
```

Even if:

```text
load()
```

blocks while waiting for I/O, the virtual thread may unmount and release its carrier.

So the application can keep:

```text
simple sequential control flow
```

without requiring:

```text
one OS thread
```

for every waiting task.

## JDK 25 changes an important old Loom warning

Older Loom tutorials frequently warn:

```text
synchronized
      │
      ▼
virtual thread pinned
      │
      ▼
carrier cannot be reused
```

For a JDK 25 course, that is outdated as a general rule.

JEP 491 changed HotSpot so virtual threads can unmount when blocking while holding monitors acquired through ordinary `synchronized` methods or blocks.

So for our JDK 25 baseline:

```text
synchronized
≠
automatically pinned
```

<figure>
<a href="/images/courses/jvm/jdk25-synchronized-virtual-thread.svg" aria-label="Open JDK 25 synchronized virtual-thread behavior">
<img src="/images/courses/jvm/jdk25-synchronized-virtual-thread.svg"
     alt="An older model shows synchronized code pinning a virtual thread to its carrier. The JDK 25 model shows ordinary monitor ownership no longer inherently preventing unmounting."
     width="840" height="490" />
</a>
<figcaption>JEP 491 removed ordinary monitor ownership as the major virtual-thread pinning limitation described in older Loom material.</figcaption>
</figure>

This is an important version-specific correction.

> **Common misconception:** On JDK 25, using `synchronized` does not inherently mean a virtual thread stays pinned to its carrier while blocking.

## Can a virtual thread still fail to unmount?

Yes.

The broader rule is not:

```text
virtual threads always unmount whenever blocked
```

Some execution circumstances can still prevent normal unmounting.

For example, native-frame interaction can matter.

So prefer:

```text
many JDK blocking operations
can unmount virtual threads
```

rather than:

```text
all blocking always frees the carrier
```

This is another reason our lessons distinguish:

```text
conceptual model
```

from:

```text
absolute implementation guarantee
```

## Virtual threads and TLABs

Recall Lesson 8.

TLABs belong to HotSpot execution threads, not permanently to every logical virtual thread.

That now makes more sense.

Suppose:

```text
V1
```

runs on:

```text
Carrier A
```

and allocates objects.

Later V1 unmounts.

Then:

```text
V2
```

runs on Carrier A.

Do not imagine:

```text
V1 owns one permanent TLAB
V2 owns another permanent TLAB
```

for their entire lifetimes.

The allocation fast path is associated with the underlying HotSpot execution/carrier machinery while a virtual thread is mounted.

This is one reason:

```text
1,000,000 virtual threads
```

does not imply:

```text
1,000,000 simultaneously reserved TLABs
```

That connection closes a loop back to our allocation lessons.

## Virtual threads and thread-local storage

Another potential confusion:

```text
virtual thread
```

does not mean:

```text
all thread-local state disappears
```

A virtual thread is still a Java `Thread`.

It has its own Java thread identity.

So concepts such as:

```text
Thread.currentThread()
ThreadLocal
interrupt status
thread name
```

still apply at the virtual-thread level.

The carrier should generally remain an implementation detail from application code's perspective.

This is essential.

Otherwise, mounting onto a different carrier would break normal thread semantics.

## The carrier should not leak into application identity

Suppose:

```text
V1
```

first executes on:

```text
Carrier A
```

then blocks.

Later it resumes on:

```text
Carrier B
```

Application code should still observe:

```text
same virtual Thread
```

not:

```text
new thread because carrier changed
```

Conceptually:

```text
V1 identity
   │
   ├── run on Carrier A
   │
   ├── suspend
   │
   └── resume on Carrier B
```

The logical Java thread did not change.

Only its current execution resource changed.

## Virtual threads do not remove resource bottlenecks

Now imagine:

```text
100,000 virtual threads
```

all execute:

```text
database.query()
```

The application has a database pool with:

```text
100 connections
```

Virtual threads do not turn that into:

```text
100,000 database connections
```

Instead:

```text
100,000 requests
        │
        ▼
100 DB connections
        │
        ▼
scarce downstream capacity
```

<figure>
<a href="/images/courses/jvm/virtual-thread-resource-limit.svg" aria-label="Open virtual-thread downstream resource limits">
<img src="/images/courses/jvm/virtual-thread-resource-limit.svg"
     alt="One hundred thousand virtual threads converge on a database connection pool containing only one hundred useful connections, demonstrating that virtual threads do not increase downstream resource capacity."
     width="840" height="480" />
</a>
<figcaption>Virtual threads remove thread scarcity from many designs, but they do not remove scarcity in databases, remote services, file descriptors, rate limits, or other constrained resources.</figcaption>
</figure>

> **Production note:** Virtual threads reduce the need to limit concurrency merely to protect OS-thread counts. You may still need concurrency limits to protect the resource being called.

This is an important architectural shift.

Before virtual threads, a fixed thread pool often did two jobs at once:

```text
limit OS threads
+
limit downstream concurrency
```

With virtual threads, those concerns should be separated.

## Platform thread vs virtual thread

A useful summary:

| Property | Platform thread | Virtual thread |
| --- | --- | --- |
| Java `Thread` | Yes | Yes |
| Permanently associated with one OS thread | Normally yes | No |
| Runs on carrier | It is itself a platform/carrier thread | Yes |
| Waiting can consume OS-thread resource | Yes | Often can unmount |
| Stack model | Native-thread stack | Continuation/stack chunks |
| Good for huge blocking concurrency | Limited by OS-thread cost | Designed for this |
| Creates more CPU cores | No | No |

The main shift is not in Java semantics.

It is in the execution-resource model.

## Check your reasoning

Suppose the application has:

```text
50,000 virtual threads
```

and:

```text
16 carrier platform threads
```

Does that mean only 16 virtual threads can exist?

<details class="lesson-check">
<summary>Pause here, then check your reasoning</summary>
<p>No. Many virtua

[Retrieval truncated at 20,000 characters.]

