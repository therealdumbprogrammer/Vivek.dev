# Daily JVM Byte #17 — Safepoints: when HotSpot needs Java threads in a known state

Stable source ID: `byte-017`

We have reached an important connection point. So far:

```text
Interpreter → profiling → C1 → C2 → Code Cache
                              ↓
                       deoptimization
```

All of these mechanisms operate while application threads are continuously modifying JVM state.

But some VM operations need a stronger guarantee:

> HotSpot sometimes needs Java threads to be at execution points where their JVM state is well-defined and safely inspectable.

That is the purpose of a **safepoint**.

### Why safepoints exist

Consider a stop-the-world GC.

The collector needs to inspect references from thread stacks:

```text
Thread A frame ──→ Object X
Thread B frame ──→ Object Y
Thread C frame ──→ Object Z
```

But suppose Thread A happens to be halfway through generated machine instructions that temporarily transform its state:

```text
register R1 contains reference
instruction executes
reference moves
stack slot updated
...
```

Arbitrarily freezing execution at any CPU instruction would make it difficult for HotSpot to reliably answer:

```text
Which registers contain object references?
Which stack slots contain references?
What Java frame does this machine state represent?
```

Instead, compiled code contains known locations where HotSpot has sufficient metadata to understand the execution state.

Those locations participate in the safepoint mechanism.

Current HotSpot explicitly tracks whether Java threads have reached safepoint-safe states during global safepoint synchronization. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/safepoint.hpp?utm_source=chatgpt.com))

---

## 1. A safepoint is not simply "all threads suspended"

A better model is:

```text
Safepoint requested
        ↓
Java threads cooperate
        ↓
each reaches / is recognized in
a safepoint-safe state
        ↓
VM performs operation
```

HotSpot's safepoint implementation describes this as rolling Java threads forward to a safepoint. Some threads may already be in states that require no further Java execution—for example blocked or executing native code—and can be handled appropriately by the synchronization protocol. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/safepoint.hpp?utm_source=chatgpt.com))

So avoid thinking:

```text
OS forcibly pauses every thread
```

Think:

```text
HotSpot establishes a globally safe JVM state
```

---

## 2. Safepoint polling

Compiled code cooperates by periodically checking whether HotSpot has requested safepoint-related work.

Conceptually:

```text
normal application code
        ↓
...
        ↓
safepoint poll
        ↓
requested?
   /          \
 no            yes
 ↓              ↓
continue      enter runtime
```

Polls occur at carefully selected execution locations, notably around loop execution, method returns, and certain runtime transitions. Modern HotSpot also has thread-local polling infrastructure used by handshakes. ([OpenJDK Bug System](https://bugs.openjdk.org/secure/attachment/111706/Cooperative_JFR_Sampling_draft_06.pdf?utm_source=chatgpt.com))

The normal path needs to remain extremely cheap because these checks execute frequently.

---

## 3. Why loops need polling

Consider:

```java
while (true) {
    calculate();
}
```

Imagine the compiled loop contained no calls or other transition points.

Without a poll somewhere along the execution path:

```text
Thread A:

loop
 ↑ ↓
 ↑ ↓
 ↑ ↓
 ↑ ↓ forever
```

the thread might never cooperate with a safepoint request.

So compiled loops generally need suitable safepoint opportunities.

This creates a trade-off:

```text
more polling
→ quicker safepoint responsiveness
→ more execution overhead

less polling
→ lower hot-loop overhead
→ potentially slower safepoint response
```

Compilers can therefore optimize safepoint placement; HotSpot's optimizing compiler contains explicit safepoint handling around loops. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/opto/loopnode.cpp?utm_source=chatgpt.com))

---

## 4. What happens during a global safepoint?

Simplifying considerably:

```text
VM requests safepoint
        ↓
polling mechanism activated
        ↓
Thread A reaches safe state ─┐
Thread B reaches safe state ─┼─→ waiting
Thread C reaches safe state ─┘
        ↓
all required Java threads safe
        ↓
VM operation executes
        ↓
safepoint ends
        ↓
threads continue
```

HotSpot internally distinguishes states corresponding to:

```text
not synchronized
synchronizing
synchronized
```

and considers synchronization complete when Java threads are stopped at a safepoint or are in other states the VM can safely account for. ([GitHub](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/safepoint.hpp?utm_source=chatgpt.com))

---

## 5. GC is not the only reason

Safepoints are strongly associated with GC, but:

```text
safepoint ≠ GC
```

Other VM operations can require globally coordinated thread state.

The important architecture is:

```text
Java threads
     ↓
safepoint protocol
     ↓
stable global JVM state
     ↓
VM operation
```

So when investigating pauses, do not automatically conclude:

```text
pause → GC
```

The cause could be another VM operation.

---

## 6. Safepoint synchronization time vs operation time

This distinction matters in production.

Suppose:

```text
Safepoint requested
        │
        ├── 40 ms waiting for threads
        │
        ▼
all threads safe
        │
        ├── 5 ms VM operation
        │
        ▼
resume
```

The application experienced roughly:

```text
45 ms disruption
```

but the actual VM operation took only:

```text
5 ms
```

The first component is the time required to establish the safepoint.

This is why:

```text
long pause
```

does not necessarily mean:

```text
slow GC work
```

A thread that takes unusually long to reach a safe state can increase the overall pause.

---

## 7. Connection to JIT compilation

Byte #16 introduced `nmethod` metadata.

Now we can see why compiled code needs metadata beyond machine instructions.

At a safepoint HotSpot may need to know:

```text
machine register R8 → Java reference
stack slot 24       → Java reference
stack slot 32       → primitive
```

Conceptually:

```text
compiled machine state
        +
JIT-generated metadata
        ↓
HotSpot understands
Java execution state
```

That enables operations such as:

```text
GC root scanning
stack walking
deoptimization
```

This is the bridge between the JIT and GC subsystems.

---

## 8. Safepoints and deoptimization

Recall Byte #15:

```text
optimized C2 frame
       ↓
deoptimization
       ↓
logical Java frames reconstructed
```

HotSpot cannot reconstruct arbitrary optimized machine state without knowing where values live.

The JIT therefore records enough metadata at appropriate execution locations to map optimized state back into JVM-level state.

So these concepts are tightly connected:

```text
JIT compilation
      │
      ├── machine code
      │
      └── runtime metadata
              ↓
         safepoints
         GC scanning
         stack walking
         deoptimization
```

---

## Production implication

Safepoint diagnostics are useful when you see latency that GC metrics alone do not explain.

On modern HotSpot, unified logging can expose safepoint activity, for example:

```bash
-Xlog:safepoint
```

and more detailed logging can be enabled when investigating specific issues.

A useful diagnostic sequence is:

```text
application pause observed
        ↓
Was there a safepoint?
        ↓
Which VM operation?
        ↓
Was time spent reaching the safepoint
or executing the operation?
```

That is much more precise than assuming every JVM pause is caused by garbage collection.

---

## Mental model checkpoint

We can now connect execution and memory management:

```text
              Java threads
                   │
                   ▼
             compiled code
                   │
          safepoint polling
                   │
                   ▼
        ┌────────────────────┐
        │ Safe JVM state     │
        └────────────────────┘
             │          │
             ▼          ▼
            GC       VM operations
             │
             └─────► resume
```

Safepoints are therefore not fundamentally a GC feature.

They are a **coordination mechanism between executing Java threads and the HotSpot runtime**.

One more distinction is now important: modern HotSpot does not always need to stop **every** Java thread to perform runtime work. It can often coordinate with one particular thread instead.

**Next byte:** **Thread-local handshakes — how modern HotSpot performs operations on individual Java threads without requiring a global safepoint, and where handshakes fit alongside safepoint polling.**

---

## Archive note

This file preserves the supplied byte under stable ID `byte-017`. The integrated lesson records the reviewed expansion, JDK 25 source links, diagrams, and implementation caveats.
