Next two bytes:



## Daily JVM Byte #37 — Native Memory Tracking: explaining “heap looks fine, process is huge”

Yesterday JNI showed us an important boundary: not all memory in a JVM process belongs to the Java heap—or even to HotSpot.

Today we make that operational with **Native Memory Tracking (NMT)**.

The question NMT helps answer is:

> **Where is HotSpot-managed native memory going, and which category is growing?**

### 1. The problem NMT solves

Suppose production shows:
```
Container memory:  6.8 GB
Java heap used:    2.1 GB
-Xmx:              4 GB
```

GC looks healthy.

Where are the other gigabytes?

Our current model says:
```
JVM Process
│
├── Java Heap
├── Metaspace / Class
├── Code Cache
├── Thread stacks
├── GC structures
├── Compiler
├── JVM internals
└── other native allocations
```

NMT exposes many of these HotSpot allocations by category.

---

## 2. Enabling NMT

NMT must be enabled when the JVM starts:
```
-XX:NativeMemoryTracking=summary
```

or:
```
-XX:NativeMemoryTracking=detail
```

Then query it with:
```
jcmd <pid> VM.native_memory summary
```

Conceptually:
```
Native Memory Tracking

Total
│
├── Java Heap
├── Class
├── Thread
├── Code
├── GC
├── Compiler
├── Internal
├── Symbol
├── NMT
└── ...
```

`summary` is usually the right starting point.

`detail` adds allocation-site and virtual-memory-map information and has additional tracking overhead.

---

## 3. Reserved vs committed

Typical NMT output looks conceptually like:
```
Java Heap
    reserved=6291456KB
    committed=397312KB

Class
    reserved=1048685KB
    committed=12000KB
```

These numbers mean different things.

### Reserved
```
reserved
   ↓
virtual address space HotSpot
has reserved for possible use
```

### Committed
```
committed
   ↓
pages HotSpot has committed
for actual use
```

Therefore:
```
reserved = 6 GB
committed = 400 MB
```

does **not** mean 6 GB of RAM is currently occupied.

This is particularly visible with things such as the heap and compressed class space, where HotSpot can reserve large address ranges.

---

## 4. NMT committed is still not RSS

There is another important boundary:
```
NMT committed
      ≠
process RSS
```

Why?

NMT answers:

> What memory has HotSpot reserved/committed through allocations that NMT tracks?

The operating system answers:

> Which process pages are currently resident in physical memory?

Those are different accounting systems.

Conceptually:
```
HotSpot view                    OS view

reserved                       virtual mappings
committed                      resident/nonresident pages
NMT categories                 RSS
```

So this is perfectly possible:
```
NMT committed: 5.2 GB
RSS:           4.4 GB
```

or another relationship depending on page residency, shared mappings, allocator behavior and memory not tracked by NMT.

Do not attempt to make the two totals match exactly.

---

## 5. Categories tell the story

Suppose:
```
Java Heap
    committed = 3.0 GB

Thread
    committed = 800 MB

Class
    committed = 250 MB

Code
    committed = 180 MB

GC
    committed = 400 MB
```

Now the process is no longer simply:
```
"Java uses lots of memory."
```

We have hypotheses.

For example:
```
Thread = unusually large
          ↓
How many platform threads?
          ↓
What is -Xss?
          ↓
Are thread counts increasing?
```

Or:
```
Class increasing
       ↓
Are classes/loaders increasing?
       ↓
Possible class-loader retention?
```

Or:
```
Code unusually large
       ↓
inspect Code Cache
       ↓
Compiler.codecache
```

NMT turns process memory into JVM subsystems.

---

## 6. The most useful feature: baseline and diff

A single snapshot answers:
```
Where is memory now?
```

Production incidents often require a different question:

> **What grew?**

Take a baseline:
```
jcmd <pid> VM.native_memory baseline
```

Wait while process memory increases.

Then:
```
jcmd <pid> VM.native_memory summary.diff
```

You might see conceptually:
```
Thread
    committed=850MB +420MB

Class
    committed=230MB +4MB

Code
    committed=170MB +1MB
```

The investigation has changed completely.

Instead of inspecting everything:
```
RSS increased ~500 MB
       ↓
NMT says Thread +420 MB
       ↓
investigate thread growth
```

This is one of the highest-value NMT workflows.

---

## 7. `detail` answers a different question

With:
```
-XX:NativeMemoryTracking=detail
```

you can run:
```
jcmd <pid> VM.native_memory detail
```

and obtain more detailed allocation and virtual-memory information, including call-site attribution for tracked native allocations.

Conceptually:
```
summary

Thread      800 MB
GC          400 MB
Class       250 MB
```

versus:
```
detail

Thread
   └── allocation information...

GC
   └── allocation information...

Virtual memory map
   └── address ranges...
```

Use detail when the category alone is insufficient.

Do not enable detail merely because “more data must be better.”

---

## 8. NMT has a hard diagnostic boundary

This is the subtle point.

NMT tracks **HotSpot/JVM native memory that participates in NMT accounting**.

It is not:
```
a universal malloc tracker
```

Suppose JNI code does:
```
void* p = malloc(2L * 1024 * 1024 * 1024);
```

Then you might observe:
```
RSS              +2 GB

NMT categories   little/no corresponding +2 GB
```

That discrepancy itself is useful evidence.

The reasoning becomes:
```
Process growth
     │
     ▼
Does NMT explain it?
     │
 ┌───┴────┐
yes       no
 │         │
 ▼         ▼
HotSpot   look outside NMT
category  │
          ├── JNI/native libraries
          ├── libc allocator behavior
          ├── mmap
          └── OS-level mappings
```

NMT's inability to explain memory can therefore be diagnostically meaningful.

---

## 9. A practical production workflow

Suppose Kubernetes reports:
```
container memory
4 GB → 5 GB → 6 GB → OOMKilled
```

but monitoring shows:
```
heap after GC ≈ 2 GB
```

Do **not** conclude:
```
memory leak
    ↓
heap dump
```

Instead:
```
1. Compare heap vs process/container memory

             ↓

2. Check NMT summary

             ↓

3. Establish baseline

             ↓

4. Observe summary.diff during growth

             ↓

5. Identify growing category

             ↓

6. Choose subsystem-specific diagnostics
```

For example:
```
Class  ↑ → class-loader investigation

Thread ↑ → thread count + stacks

Code   ↑ → Code Cache / compilation

GC     ↑ → collector structures / heap configuration

Heap   ↑ → GC / histogram / heap dump

NMT doesn't explain RSS ↑
        ↓
native library / mmap / OS tooling
```

That final step prevents a common mistake: using heap diagnostics for a non-heap problem.

---

## Production implication

Consider:
```
container limit = 8 GB
-Xmx            = 7 GB
```

Even if heap usage never reaches 7 GB:
```
Heap          5.5 GB
Threads       700 MB
Class         250 MB
Code          150 MB
GC/native     500 MB
Other         ...
```

the container can hit its memory limit first.

The OS/container does not care that:
```
-Xmx has not been reached.
```

It cares about total process/container memory.

So:

> **`-Xmx` is a heap capacity decision. Container memory is a process-level capacity decision.**

## Mental model checkpoint

We can now attach diagnostic tools to memory domains:
```
                 JVM Process
                     │
       ┌─────────────┴──────────────┐
       │                            │
   Java Heap                    Native side
       │                            │
GC logs                         NMT
histogram                       │
heap dump                 ┌─────┼─────┐
                          │     │     │
                       Class Thread Code ...
                                     
                     unexplained gap
                           │
                           ▼
                    OS/native tools
```

The key lesson is:

> **NMT is not a replacement for heap analysis or OS memory tools. It is the bridge between them: it tells you how much of the process's non-heap memory HotSpot can explain and which JVM subsystem owns it.**

**Next byte:** **JVM crash anatomy — `hs_err_pid` files, SIGSEGV/access violations, problematic frames, native vs VM vs compiled-Java crashes, core dumps, and how to systematically determine what actually killed a JVM process.**



\==========




