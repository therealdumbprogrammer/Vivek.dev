# Daily JVM Byte #19

Source: chatgpt-conversation://6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3
Stable ID: byte-019

next byte



## Daily JVM Byte #19 — Platform Threads vs Virtual Threads in JDK 25

We have covered how HotSpot executes code and coordinates threads through safepoints and handshakes. Now we move to the threads themselves.

The fundamental distinction in JDK 25 is:
```text
Platform thread:
Java Thread ────────────── OS Thread

Virtual thread:
Java VirtualThread
       │
       │ mounted when running
       ▼
Carrier platform thread ── OS Thread
```

A platform thread is normally backed by an OS thread for its lifetime. A virtual thread is a Java-managed thread that is **mounted onto a carrier platform thread only while it needs CPU execution**.

### 1. Why virtual threads exist

With platform threads, a blocking operation traditionally ties up an OS thread:
```text
Request
   ↓
Platform Thread / OS Thread
   ↓
read(socket)
   ↓
waiting...
   ↓
OS thread remains associated
with that Java thread
```

This makes thread-per-request programming simple, but large numbers of concurrent blocking operations imply large numbers of OS threads.

OS threads are relatively expensive:
```text
native stack memory
kernel scheduling
context switching
OS resource limits
```

Virtual threads preserve the thread-per-task programming model without requiring one OS thread per concurrent task.

---

## 2. Mounting onto carrier threads

Virtual threads are scheduled by the JDK onto **carrier threads**, which are platform threads.

Conceptually:
```text
                 Virtual Threads

V1 ─────┐
V2 ─────┤
V3 ─────┤
V4 ─────┤
V5 ─────┘
        │
        ▼
   JVM scheduler
     /      \
    ▼        ▼
Carrier 1  Carrier 2
    │        │
    ▼        ▼
OS Thread  OS Thread
```

When `V1` executes:
```text
V1
 ↓ mount
Carrier 1
 ↓
CPU
```

Later the same carrier might execute:
```text
V7
 ↓
Carrier 1
```

The carrier is therefore an execution resource, not the permanent identity of the virtual thread.

---

## 3. Blocking and unmounting

Suppose a virtual thread performs blocking I/O:
```java
var response = socket.read(...);
```

For supported blocking operations, the runtime can effectively do:
```text
Virtual Thread V1
       │
       ▼
Carrier 1
       │
       ▼
blocking operation
       │
       ▼
V1 cannot make progress
       │
       ▼
unmount V1
       │
       ├──────── V1 waits
       │
       ▼
Carrier 1 becomes available
       │
       ▼
run V2
```

When V1 becomes runnable again:
```text
I/O ready
   ↓
V1 runnable
   ↓
scheduler
   ↓
mount onto an available carrier
```

It does not need to return to the same carrier.

That is the scalability mechanism.

---

## 4. What happens to the virtual thread's stack?

This is where the implementation becomes particularly interesting.

A platform thread has the familiar native-thread stack model:
```text
OS Thread
   │
   ▼
native stack

┌─────────────┐
│ frame C     │
├─────────────┤
│ frame B     │
├─────────────┤
│ frame A     │
└─────────────┘
```

A virtual thread cannot reserve a large native stack for every virtual thread; doing so would defeat much of its scalability advantage.

Instead, virtual-thread stacks are represented using **stack chunks** that can reside in the Java heap.

Conceptually:
```text
Virtual Thread

Heap
┌──────────────────┐
│ StackChunk       │
│ ┌──────────────┐ │
│ │ Java frames  │ │
│ │ Java frames  │ │
│ └──────────────┘ │
└──────────────────┘
```

When mounted, execution operates using the carrier while HotSpot manages the virtual thread's stack representation.

When the virtual thread unmounts, its continuation state remains available independently of the carrier.

This is why millions of virtual threads do **not** imply millions of permanently reserved traditional native thread stacks.

---

## 5. Continuations underneath the model

Conceptually, a virtual thread behaves like a resumable computation:
```text
run
 ↓
run
 ↓
block
 ↓
──────────── suspend ────────────
            state preserved
─────────────────────────────────
                 ↓
               resume
                 ↓
                run
```

The underlying HotSpot/JDK continuation machinery allows execution state to be suspended and resumed.

So:
```text
VirtualThread
      │
      ▼
Continuation
      │
      ▼
stack chunks / execution state
```

is a useful implementation-level mental model.

You normally program against `Thread`, not continuations directly.

---

## 6. Virtual threads do not make CPU work faster

Suppose you have:
```text
100,000 CPU-bound virtual threads
```

on:
```text
8 CPU cores
```

You still have approximately eight cores worth of CPU capacity.

Virtual threads improve:
```text
concurrency scalability
```

not:
```text
CPU parallelism
```

Their strongest use case is therefore workloads with substantial waiting:
```text
HTTP calls
database calls
socket I/O
queues
other blocking operations
```

For CPU-bound work, the number of useful simultaneously executing tasks remains constrained by available processors.

---

## 7. Pinning: an important JDK 25 change

Older virtual-thread discussions often emphasize:
```text
synchronized
   ↓
virtual thread becomes pinned
   ↓
carrier cannot be released
```

That advice is outdated for the JDK 25 baseline.

JEP 491, delivered in JDK 24, changed HotSpot's virtual-thread implementation so that virtual threads can unmount when blocking inside `synchronized` methods and statements.

Therefore, on JDK 25:
```text
synchronized
≠
inherently pins virtual thread
```

This is an important correction when reading older Loom material.

Some situations can still prevent unmounting—for example execution involving native frames—but ordinary monitor ownership is no longer the major pinning limitation it was in earlier JDK releases.

---

## 8. Production implications

Virtual threads change the resource model from roughly:
```text
concurrent request
      ≈
OS thread
      ≈
native stack
```

toward:
```text
concurrent request
      ≈
VirtualThread + heap-resident state

active CPU execution
      ≈
carrier / OS thread
```

This means applications can sustain very high concurrency without creating equivalent numbers of OS threads.

But virtual threads do **not** remove downstream capacity limits.

For example:
```text
100,000 virtual threads
        ↓
database with 100 useful connections
```

does not create database capacity.

You still need concurrency controls around scarce resources.

---

## Mental model update

Our JVM execution model now extends beyond compiled code:
```text
Java task
   ↓
VirtualThread
   ↓
continuation + stack state
   ↓
mount
   ↓
carrier platform thread
   ↓
OS thread
   ↓
CPU

       │ blocking
       ▼

unmount
   ↓
stack state preserved
   ↓
carrier reused
```

And this connects back to our earlier memory model:
```text
Platform thread
→ significant native-thread resources

Virtual thread
→ much of suspended Java execution state
  managed through heap-resident stack chunks
```

The important idea is:

> Virtual threads decouple **Java thread identity and lifetime** from **OS thread ownership**.

That architectural change allows Java to retain straightforward blocking code while scaling concurrency far beyond the traditional one-Java-thread-per-OS-thread model.

**Next byte:** **HotSpot synchronization internals — object monitors,&#xA0;****`synchronized`****, monitor enter/exit, contention, and how JDK 25's lightweight locking model changed what happens inside an object's mark word.**

