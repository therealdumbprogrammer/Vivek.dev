# Daily JVM Byte #57 — JIT Compilation Under CPU Pressure

**Baseline:** JDK 25 LTS  
**Focus:** Compilation queues, compiler threads, CPU contention, code-cache pressure, and JVM warm-up.

In Byte #56, we examined deoptimization and how HotSpot transitions away from compiled code when optimization assumptions become invalid.

Today, we'll investigate another important aspect of JIT compilation:

> **What happens when methods become hot faster than HotSpot can compile them, especially inside CPU-constrained Kubernetes containers?**

This connects JIT compilation, JVM ergonomics, operating-system scheduling, and application latency.

---

## 1. JIT compilation consumes CPU too

Recall our earlier execution model:

```text
Java bytecode
     │
     ▼
Interpreter
     │
     ▼
Runtime profiling
     │
     ▼
Compilation requested
     │
     ▼
C1 / C2 compiler
     │
     ▼
Optimized machine code
     │
     ▼
Code Cache
```

An important detail is missing from this simplified diagram.

**Compilation itself requires CPU time.**

HotSpot uses dedicated compiler threads to transform bytecode into native machine code.

These threads compete for CPU resources with application threads, garbage collectors, and other JVM services.

On a machine with abundant CPU capacity, this competition may be relatively inexpensive.

Inside a container with a small CPU quota, it can become significant.

---

## 2. How compilation tasks are scheduled

HotSpot generally performs JIT compilation asynchronously.

When a method becomes sufficiently hot, HotSpot can create a compilation task and place it in a compiler queue.

Conceptually:

```text
Application threads
        │
        ▼
Runtime profiling
        │
        ▼
Compilation policy
        │
        ▼
Compilation queues
        │
        ├── C1 compilation tasks
        │
        └── C2 compilation tasks
                │
                ▼
         Compiler threads
                │
                ▼
         Compiled nmethods
                │
                ▼
            Code Cache
```

With tiered compilation enabled, HotSpot maintains separate compilation queues for C1 and C2.

The compilation policy determines when methods should be compiled and which compilation level is appropriate.

The compiler broker manages task scheduling and compiler-thread execution.

### Why use background compilation?

Imagine a request thread invoking a method for the 10,000th time.

If it had to wait for C2 to finish optimizing that method, the request could experience a substantial delay.

Instead, background compilation allows the application to continue executing an existing interpreted or compiled version while optimization happens separately.

In JDK 25:

```text
-XX:+BackgroundCompilation
```

is enabled by default.

Disabling it with `-Xbatch` forces synchronous compilation behavior and is generally unsuitable as a production performance optimization. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html?utm_source=chatgpt.com)

---

## 3. What happens when compilation cannot keep up?

Suppose an application starts and rapidly exercises hundreds of previously cold methods.

```text
Time 0s:
    Many methods interpreted

Time 5s:
    Methods become hot
    Compilation requests increase

Time 10s:
    Compiler threads are busy
    Compilation queues grow

Time 20s:
    Some methods are still waiting
    Others have reached C1 or C2

Time 40s:
    Compilation demand decreases
    Application approaches steady state
```

These times are illustrative.

When compilation demand exceeds available compiler capacity, tasks may wait longer in the queues.

The consequences can include delayed optimization, increased compiler CPU utilization, and longer warm-up periods.

However, **a compilation queue is not inherently a problem**.

A temporary queue during startup is normal. A persistently large queue accompanied by poor application performance is more interesting.

Also, HotSpot's compilation policy is adaptive: compilation thresholds and task priorities are not simply fixed invocation-count rules.

---

## 4. Why Kubernetes CPU limits complicate compilation

Consider a Spring Boot application deployed with:

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1"
```

The container has a CPU quota equivalent to one CPU.

Now suppose the JVM is performing several activities:

```text
Available CPU budget: 1 core equivalent

Application threads ────┐
                        │
C1 compiler threads ────┤
                        ├── Compete for CPU
C2 compiler threads ────┤
                        │
GC workers ─────────────┘
```

The JVM may have many runnable threads, but the container cannot continuously consume more CPU than its quota permits.

Under Linux CPU bandwidth control, exhausting the quota can cause the container's runnable threads to be throttled until the next quota period.

This creates two distinct effects.

**Direct contention:** Compiler threads consume CPU capacity that application threads could otherwise use.

**Delayed optimization:** Compiler threads themselves receive less CPU time, so compilation takes longer in wall-clock time.

The application may therefore spend more time executing interpreted or less-optimized code.

This can create a feedback loop:

```text
Limited CPU capacity
        │
        ▼
Slower JIT compilation
        │
        ▼
More execution in lower tiers
        │
        ▼
More CPU needed per unit of work
        │
        ▼
Additional CPU pressure
```

This is a possible workload-dependent effect, not an inevitable outcome of CPU limits.

---

## 5. How HotSpot chooses compiler-thread counts

JDK 25 provides:

```text
-XX:CICompilerCount
```

This controls the configured compiler-thread count.

By default, HotSpot selects the count ergonomically based on available processors and code-memory considerations.

It also enables:

```text
-XX:+UseDynamicNumberOfCompilerThreads
```

which allows compiler-thread creation and activity to adapt within the configured limit.

This connects directly to Byte #51, where we examined JVM ergonomics.

### Container awareness matters

HotSpot uses container-aware processor detection when determining ergonomic values.

You can override the processor count used by JVM ergonomics:

```bash
java -XX:ActiveProcessorCount=2 -jar application.jar
```

But this does not give the container two physical CPUs or increase its CPU quota.

It changes how HotSpot and some Java runtime components perceive available processing capacity.

**Trade-off:** Increasing compiler parallelism can accelerate compilation when spare CPU capacity exists. Under a restrictive CPU quota, it can instead increase contention.

Reducing compiler parallelism can preserve CPU capacity for application threads but delay optimization.

Neither direction is universally better. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html?utm_source=chatgpt.com)

---

## 6. Code-cache pressure creates another bottleneck

Recall our earlier Code Cache lesson.

Compilation does not end when machine code is generated.

HotSpot must also allocate space for that code.

```text
Compilation task
       │
       ▼
Generate machine code
       │
       ▼
Allocate Code Cache space
       │
       ├── Available → Install nmethod
       │
       └── Insufficient → Compilation may be affected
```

In JDK 25, the default maximum code-cache reservation with tiered compilation is 240 MB.

With segmented code cache, compiled code is organized into separate areas for profiled methods, non-profiled methods, and non-method code.

If the relevant code heap becomes full, HotSpot can disable compilation until sufficient space becomes available.

This is fundamentally different from a slow compilation queue.

| Problem | Mechanism | Possible consequence |
|---|---|---|
| CPU contention | Compiler threads receive insufficient CPU | Compilation completes slowly |
| Compilation backlog | Tasks arrive faster than they complete | Methods wait for optimization |
| Code-cache exhaustion | Insufficient space for compiled code | Compilation may be disabled |
| Repeated deoptimization | Compiled methods become invalid | Additional compilation demand |

These conditions can interact, but they require different investigations. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html?utm_source=chatgpt.com)

---

## 7. Hands-on: observe compiler pressure in JDK 25

We can investigate most of this without writing a special Java program.

### Step 1 — Inspect compiler configuration

```bash
java -XX:+PrintFlagsFinal -version \
  | grep -E 'CICompilerCount|UseDynamicNumberOfCompilerThreads|TieredCompilation|ReservedCodeCacheSize'
```

This reveals the selected compiler configuration.

For a controlled experiment, compare runs with different CPU limits while keeping the application workload unchanged.

### Step 2 — Observe compilation activity

Start the application with:

```bash
java \
  -XX:+PrintCompilation \
  -jar application.jar
```

You might see:

```text
  125  184   3  com.example.Service::calculate (45 bytes)
  190  185   4  com.example.Service::calculate (45 bytes)
```

*Illustrative output.*

The numbers include compilation timestamps, compilation IDs, and compilation levels.

Here, the method was compiled at level 3 and subsequently at level 4.

Recall:

- **Level 3:** C1 compilation with full profiling.
- **Level 4:** C2 compilation.

This demonstrates the transition toward more optimized execution.

### Step 3 — Inspect compilation queues

For a running JVM:

```bash
jcmd <pid> Compiler.queue
```

This prints methods currently queued for compilation.

Capture it during startup and again after the application has warmed up.

A useful comparison:

```text
Startup:
    Multiple queued compilation tasks

Steady state:
    Queue frequently empty
```

An empty queue only means no tasks were waiting at that instant; it does not prove that compilation is inactive.

### Step 4 — Inspect code-cache occupancy

```bash
jcmd <pid> Compiler.codecache
```

This reports code-cache layout and usage.

Look for remaining free space and whether the relevant code heaps are approaching capacity.

Both diagnostic commands are supported by JDK 25. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)

---

## 8. Correlating compilation with application performance

Suppose a service experiences high latency during its first minute after startup.

You observe:

| Metric | First minute | After warm-up |
|---|---|---|
| Application p99 | 180 ms | 35 ms |
| CPU utilization | Near quota | Moderate |
| Compilation activity | High | Low |
| Compilation queue | Frequently populated | Mostly empty |
| GC pauses | Low | Low |

*Illustrative measurements.*

This suggests that JIT warm-up and CPU competition may contribute to the startup latency.

But compilation activity alone does not establish causation.

Class loading, framework initialization, lazy dependency creation, cache population, and external service connections can also affect startup behavior.

A useful investigation combines compilation data with CPU utilization, throttling metrics, and application latency.

### Production implications

For Kubernetes applications, pay particular attention to the period between process startup and accepting production traffic.

A JVM can be ready to serve requests before its important methods have reached their most optimized compilation levels.

Readiness probes verify application-defined readiness conditions; they do not automatically establish JIT warm-up completion.

This is one reason load tests should distinguish **cold-start performance** from **steady-state performance**.

---

## 9. Connecting to HotSpot source

The relevant implementation areas include:

| Source | Responsibility |
|---|---|
| `compiler/compileBroker.cpp` | Compilation task scheduling and compiler-thread management |
| `compiler/compileTask.cpp` | Individual compilation tasks |
| `compiler/compilerDefinitions.cpp` | Compiler-related definitions and configuration |
| `compiler/compilationPolicy.cpp` | Compilation policy infrastructure |
| `code/codeCache.cpp` | Compiled-code storage and code-cache management |

A useful starting point is the [JDK 25 CompileBroker implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/compiler/compileBroker.cpp?utm_source=chatgpt.com).

Notice that compiler threads are ordinary JVM-managed native threads competing for operating-system scheduling resources.

The JIT compiler is not an external service with independent CPU capacity.

---

## Mental model checkpoint

We can now connect JIT compilation with the runtime resource model:

```text
Application execution
        │
        ▼
Runtime profiling
        │
        ▼
Compilation policy
        │
        ▼
Compilation queues
        │
        ▼
Compiler threads ◄──── CPU availability
        │                       │
        ▼                       │
C1 / C2 compilation       Container quota
        │
        ▼
Compiled nmethods
        │
        ▼
Code Cache
        │
        ▼
Optimized execution
        │
        ▼
Application throughput / latency
```

### Key takeaway

**JIT compilation is an investment of CPU resources today to reduce application execution costs later.**

Under CPU pressure, HotSpot must balance compilation work against useful application execution.

Too little compilation capacity can delay optimization. Too much compilation activity can compete with application threads.

Production performance therefore depends not only on how efficiently C2 optimizes methods, but also on **when those optimizations become available and what they cost to produce**.

### Next byte — #58: JVM Warm-up Versus Steady State

We'll connect class loading, interpretation, tiered compilation, deoptimization, GC activity, and runtime initialization into one model.

The central question:

**When can we confidently say that a Java application has warmed up—and why is a fixed warm-up duration often misleading?**

**References:** [JDK 25 HotSpot performance guide](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html?utm_source=chatgpt.com) · [JDK 25 JVM options](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html?utm_source=chatgpt.com) · [JDK 25 diagnostic command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)