## Daily JVM Byte #39 — JVM diagnostics as a system: choosing the right observation layer

Yesterday we covered JVM crashes. Today we connect the diagnostic tools we've encountered into one model.

The central idea:

> **There is no single “JVM diagnostic tool.” Each tool observes a different layer of the running system.**
```
Application behavior
        ↓
Threads / execution
        ↓
Java Heap
        ↓
HotSpot runtime
        ↓
Native process
        ↓
OS / container
```

A good investigation starts by choosing the **smallest observation layer capable of answering the question**.

### 1. `jcmd`: the control plane

`jcmd` is best thought of as an entry point into HotSpot's diagnostic capabilities.
```
jcmd <pid> help
```

It can request many VM operations:
```
jcmd
 │
 ├── Thread.print
 ├── GC.class_histogram
 ├── GC.heap_dump
 ├── JFR.start
 ├── JFR.dump
 ├── VM.native_memory
 ├── Compiler.codecache
 ├── VM.classloader_stats
 └── ...
```

So `jcmd` itself is not one diagnostic technique. It exposes multiple HotSpot subsystems.

---

## 2. Thread dump: “What are threads doing now?”

Use:
```
jcmd <pid> Thread.print
```

when the question is:
```
Why is the application stuck?
Why is this request hanging?
Are threads blocked?
Is there a deadlock?
What is consuming CPU?
```

A thread dump gives a **point-in-time execution snapshot**:
```
worker-1
  RUNNABLE
    PaymentService.calculate()
    ...

worker-2
  BLOCKED
    waiting to lock ...

worker-3
  WAITING
    LockSupport.park()
```

Its weakness is precisely that it is a snapshot.

One dump:
```
t = 10:00:00
```

does not tell you whether that stack was active for:
```
1 µs
```

or:
```
10 minutes
```

Repeated dumps or JFR provide temporal context.

---

## 3. JFR: “What happened over time?”

Java Flight Recorder observes runtime behavior as events.
```
time ─────────────────────────────►

GC ─────●────────●────────────●────
CPU ──●●●●─────●●─────────●●●●────
Locks ─────●─────────●──────────────
I/O ──●────────────●──────●─────────
```

This makes JFR particularly useful for questions such as:
```
Where was CPU spent?
Were there long GC pauses?
Which locks were contended?
Were threads frequently parked?
Did allocation rates spike?
What happened before latency increased?
```

Compare:
```
Thread dump
    ↓
"What is happening now?"

JFR
    ↓
"What happened during this interval?"
```

JFR is often the better first tool for intermittent production-performance problems because the problem may have disappeared by the time you inspect the process.

---

## 4. Heap histogram: cheap object census

Before taking a multi-gigabyte heap dump, ask whether you only need:

> Which object types dominate the heap?

Use:
```
jcmd <pid> GC.class_histogram
```

Conceptually:
```
Class                       Instances       Bytes

byte[]                       400,000       600 MB
String                       900,000        40 MB
Order                        500,000        32 MB
...
```

This can quickly reveal:
```
"Why is heap occupancy increasing?"
          ↓
byte[] population increased dramatically
```

Repeated histograms are especially useful:
```
10:00   Order = 100k
10:05   Order = 300k
10:10   Order = 700k
```

Now you have evidence of population growth.

But a histogram cannot answer:
```
Who retains these objects?
```

For that, you need object-reference relationships.

---

## 5. Heap dump: reachability and retention

A heap dump provides the object graph:
```
GC Root
   │
   ▼
Cache
   │
   ▼
Map
   │
   ├── Order
   ├── Order
   ├── Order
   └── ...
```

Now tools can calculate concepts such as:
```
shallow size
retained size
dominator tree
path to GC root
```

This makes heap dumps appropriate for:
```
memory leaks
unexpected retention
large retained graphs
OOM investigation
```

But they are substantially heavier than a histogram.

So:
```
"What classes are growing?"
        ↓
histogram

"Why can't these objects be collected?"
        ↓
heap dump
```

---

## 6. GC logs: collector behavior

GC logs answer a different question:

> **How is the collector behaving over time?**

For example:
```
allocation
    ↓
young GC
    ↓
reclaim
    ↓
heap after GC
```

Useful signals include:
```
GC frequency
pause duration
heap before/after GC
promotion
concurrent-cycle behavior
allocation pressure
```

Suppose latency increases every few minutes.

GC logs may reveal:
```
latency spike
     │
     ▼
400 ms GC pause
```

But if:
```
GC pauses = 5 ms
```

while requests stall for:
```
3 seconds
```

GC is probably not the primary explanation.

This is why correlating GC logs with JFR/application telemetry is stronger than examining GC in isolation.

---

## 7. NMT: HotSpot native memory

From Byte #37:
```
jcmd <pid> VM.native_memory summary
```

answers:
```
Where is HotSpot-managed native memory going?
```

Typical categories:
```
Java Heap
Class
Thread
Code
GC
Compiler
Internal
...
```

NMT complements heap diagnostics:
```
Heap dump
    ↓
Java object memory

NMT
    ↓
HotSpot native memory
```

Neither completely explains process RSS.

---

## 8. OS/container metrics: the outer boundary

Eventually the JVM is just a process.

The OS/container sees:
```
CPU
RSS
virtual memory
threads
page faults
I/O
cgroup limits
```

This is the authoritative layer for questions such as:
```
Why was the container OOM-killed?
How much physical memory is resident?
Is CPU actually saturated?
Is the process being throttled?
```

The JVM may report:
```
heap healthy
```

while Kubernetes reports:
```
memory.current ≈ memory.max
```

Both can be correct.

They observe different boundaries.

---

# 9. Think in questions, not tools

A common diagnostic mistake is:
```
production issue
      ↓
"I'll take a heap dump."
```

Instead:
```
production issue
      ↓
What question am I answering?
      ↓
choose observation layer
      ↓
choose tool
```

A compact map:

| Question                               | First useful view    |
| -------------------------------------- | -------------------- |
| Why is the process using CPU?          | OS CPU + JFR         |
| Why is it stuck now?                   | Thread dump          |
| Why was it slow earlier?               | JFR                  |
| Which objects dominate heap?           | Histogram            |
| Why are objects retained?              | Heap dump            |
| Is GC causing latency?                 | GC logs / JFR        |
| Why is native JVM memory growing?      | NMT                  |
| Why is RSS larger than JVM accounting? | OS + NMT             |
| Why did JVM crash?                     | `hs_err` + core dump |
| Why was container killed?              | container/OS metrics |

The important word here is **first**. Investigation can move between layers as evidence develops.

---

## 10. Example: process memory keeps growing

Suppose:
```
RSS
4 GB → 5 GB → 6 GB

heap after GC
2.1 GB → 2.1 GB → 2.2 GB
```

Do not start with a heap dump.

Reason from the boundary:
```
RSS grows
   │
   ▼
Is heap growing?
   │
   no
   ▼
NMT baseline/diff
   │
   ├── Thread grows
   │       ↓
   │   thread count + Thread.print
   │
   ├── Class grows
   │       ↓
   │   classloader_stats
   │
   └── NMT doesn't explain growth
           ↓
       OS/native investigation
```

Each result determines the next diagnostic step.

That is much more efficient than collecting every possible artifact.

---

## Production implications

Diagnostic tools themselves have costs.

Conceptually:
```
lower disturbance
      │
      ▼
metrics / logs
JFR
thread dump
histogram
      │
heap dump
      ▼
higher potential disturbance
```

This is not an absolute ordering—cost depends on workload, configuration and operation—but it captures an important production principle:

> **Start with low-cost evidence and escalate only when the current layer cannot answer the question.**

A 20 GB heap dump should not be your first response to unexplained process RSS.

---

## Mental model checkpoint

We can now overlay diagnostics onto the JVM architecture we've built:
```
                  Application
                       │
                 JFR / telemetry
                       │
              ┌────────┴────────┐
              │                 │
           Threads            Heap
              │                 │
        Thread.print      histogram/dump
              │                 │
              └────────┬────────┘
                       │
                    HotSpot
                       │
              GC logs / NMT /
              compiler diagnostics
                       │
                       ▼
                 Native process
                       │
                  OS / cgroup
                       │
                       ▼
                    Machine
```

This completes an important transition in the course. We are no longer learning JVM subsystems independently. We can now move from:
```
symptom
   ↓
runtime subsystem
   ↓
observation layer
   ↓
diagnostic evidence
```

rather than guessing from symptoms.

The central idea is:

> **JVM diagnosis is a layered observation problem. Heap tools explain heap state, JFR explains runtime events, NMT explains much of HotSpot native memory, and OS/container tools explain the process boundary. Good diagnosis starts by identifying which layer can actually observe the suspected failure.**

**Next byte:** **HotSpot runtime internals — `JavaThread`, `Thread`, `Klass`, `Method`, `ConstantPool`, `nmethod`, `ClassLoaderData` and other core VM structures: connecting the abstractions we've learned to the actual C++ object model inside HotSpot.**



