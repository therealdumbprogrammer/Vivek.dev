# Daily JVM Byte #58 — JVM Warm-up vs. Steady State: When Is Java Actually Ready?

**Baseline:** JDK 25 LTS  
**Focus:** Runtime initialization, tiered compilation, profiling, GC stabilization, and reliable performance measurement.

In Byte #57, we examined how JIT compilation consumes CPU, how compilation queues behave, and why CPU-constrained containers can experience longer warm-up periods.

Today, we'll connect several concepts we've studied throughout the course.

The central question:

> **When can we confidently say that a Java application has warmed up, and why is waiting a fixed number of seconds often insufficient?**

## 1. What does JVM warm-up actually mean?

Consider a Spring Boot application.

It starts successfully:

```text
Application started in 4.2 seconds
```

Does that mean the JVM has reached its optimal execution state?

Not necessarily.

At this point, several activities may still be ongoing:

| Component | Possible state after startup |
|---|---|
| Class loading | Additional classes loaded lazily |
| Interpreter | Some methods still interpreted |
| C1 compiler | Profiling and compiling frequently executed methods |
| C2 compiler | Optimizing hot methods |
| Code Cache | New compiled methods being installed |
| Garbage collector | Learning allocation and survival patterns |
| Application | Initializing caches and lazy dependencies |

The application can serve requests while these activities continue.

**Application startup completion and JVM performance stabilization are different milestones.**

---

## 2. Warm-up is a progression, not a switch

Recall our earlier lessons on tiered compilation.

A frequently executed method may progress through:

```text
Java bytecode
      │
      ▼
Interpreter — Level 0
      │
      ▼
C1 compilation
      │
      ├── Level 1: Limited optimization
      ├── Level 2: Limited profiling
      └── Level 3: Full profiling
      │
      ▼
C2 compilation — Level 4
      │
      ▼
Highly optimized machine code
```

This is a conceptual progression, not a mandatory sequence for every method.

HotSpot's compilation policy can select different paths depending on execution profiles and compiler availability.

Importantly, methods do not all warm up simultaneously.

Consider:

```java
class OrderService {

    Order findOrder(long id) {
        // Frequently executed
    }

    Invoice generateInvoice(long id) {
        // Rarely executed
    }
}
```

Suppose the application receives 10,000 requests to `findOrder()` during startup.

That method may become highly optimized.

However, `generateInvoice()` might remain interpreted until its first substantial workload.

Therefore:

**A JVM can be warmed up for one workload and cold for another.**

---

## 3. Runtime profiling can change after warm-up

Recall Byte #56 on deoptimization.

Suppose a method initially receives only one implementation:

```java
double calculate(DiscountPolicy policy, double amount) {
    return policy.apply(amount);
}
```

During warm-up:

```text
RegularDiscount: 100%
PremiumDiscount:   0%
```

C2 may optimize the call site around `RegularDiscount`.

Later, production traffic changes:

```text
RegularDiscount: 50%
PremiumDiscount: 50%
```

The optimized code may encounter unexpected receiver types.

Depending on its guards and assumptions, HotSpot might use a fallback, deoptimize, or eventually recompile with a different optimization strategy.

Consequently:

```text
Warm-up completed
        │
        ▼
Workload changes
        │
        ▼
Execution profiles become less representative
        │
        ▼
Possible deoptimization / recompilation
        │
        ▼
New performance characteristics
```

This explains why **steady state does not mean the JVM has permanently stopped optimizing**.

HotSpot continues adapting to application behavior.

---

## 4. GC has its own warm-up behavior

JIT compilation is only one part of the story.

Recall Byte #51 on GC ergonomics.

G1 uses historical observations to predict collection costs and make decisions about young-generation sizing, marking initiation, and collection-set composition.

During early execution:

```text
Application starts
       │
       ▼
Initial allocation patterns
       │
       ▼
Young GC observations
       │
       ▼
Survival-rate estimates
       │
       ▼
Adaptive GC decisions
```

As the application continues, these estimates may become more representative of its workload.

Consider two phases:

| Metric | Early execution | Sustained workload |
|---|---|---|
| Allocation rate | Irregular | Relatively stable |
| Object survival | Changing | More predictable |
| Young GC frequency | Variable | More consistent |
| Old-generation occupancy | Increasing | Possibly stabilizing |
| GC pause duration | Variable | Potentially more predictable |

These are possible patterns, not guarantees.

An application with periodic batch processing or unpredictable traffic may never exhibit a single stable allocation pattern.

**JIT warm-up and GC stabilization are related, but independent processes.**

---

## 5. What does steady state mean?

For performance engineering, a useful definition is:

> Steady state is an observation period during which the workload and the performance characteristics relevant to our experiment are sufficiently stable.

Notice that this is an operational definition.

HotSpot does not expose a universal `isWarmedUp()` flag.

We can instead examine several signals.

| Signal | What to observe |
|---|---|
| Application throughput | No sustained warm-up-related upward trend |
| Application latency | Distribution becomes reasonably consistent |
| Compilation activity | Initial compilation burst subsides |
| Compilation queues | No persistent backlog |
| Deoptimization | No repeated disruptive adaptation |
| GC behavior | No significant unexplained changes |
| CPU utilization | Relatively stable under equivalent load |

No single signal proves steady state.

For example, an empty compilation queue does not guarantee that every important method has reached C2.

Similarly, stable CPU utilization does not guarantee stable p99 latency.

The objective is to identify a sufficiently stable measurement window, not to prove that the JVM has become static.

---

## 6. Why fixed warm-up durations can mislead

Suppose we run a load test:

```text
Warm-up: 30 seconds
Measurement: 5 minutes
```

This assumes that 30 seconds is sufficient.

But consider two environments.

**Environment A:**

```text
CPU: 8 cores
Heap: 4 GB
JIT compilation: completes quickly
```

**Environment B:**

```text
CPU quota: 1 core
Heap: 4 GB
JIT compilation: competes with application threads
```

The same application may reach comparable performance stability at very different times.

Moreover, workload intensity matters.

Thirty seconds at 10 requests per second exercises substantially fewer method invocations than thirty seconds at 2,000 requests per second.

A better approach is to warm up with a **representative workload** and examine whether the metrics have stabilized.

This is also why the Java Microbenchmark Harness separates warm-up iterations from measurement iterations. JMH supports explicit warm-up configuration and multiple JVM forks, although the chosen warm-up duration still needs to be appropriate for the benchmark. [Javadoc](https://javadoc.io/static/org.openjdk.jmh/jmh-core/1.37/org/openjdk/jmh/annotations/Warmup.html?utm_source=chatgpt.com)

---

## 7. Hands-on: observe warm-up with JDK 25

Let's use JFR and diagnostic commands to examine an application's first few minutes.

### Step 1 — Record execution from startup

```bash
java \
  -XX:StartFlightRecording=\
settings=profile,filename=warmup.jfr,dumponexit=true \
  -jar application.jar
```

Run a representative workload, then stop the application normally so the recording is written.

### Step 2 — Inspect compilation activity

```bash
jfr print \
  --events jdk.Compilation,jdk.Deoptimization \
  warmup.jfr
```

The recording can show which methods were compiled and where uncommon execution conditions were detected.

JDK 25 also provides compiler statistics and compiler-queue utilization events that can help investigate compilation behavior. Their availability and recording frequency depend on the JFR configuration. [SAP GitHub](https://sap.github.io/jfrevents/25.html?utm_source=chatgpt.com)

### Step 3 — Observe the compilation queue

While the application is running:

```bash
jcmd <pid> Compiler.queue
```

Repeat the command during early execution and after sustained load.

Also inspect code-cache usage:

```bash
jcmd <pid> Compiler.codecache
```

These commands are supported by JDK 25. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html?utm_source=chatgpt.com)

### Step 4 — Compare performance windows

Divide the test into observation periods:

| Window | Throughput | p99 latency | Compilation activity |
|---|---:|---:|---|
| 0–30 s | 4,000 req/s | 120 ms | High |
| 30–60 s | 6,500 req/s | 75 ms | Moderate |
| 60–90 s | 7,800 req/s | 42 ms | Low |
| 90–120 s | 7,850 req/s | 41 ms | Low |
| 120–150 s | 7,830 req/s | 43 ms | Low |

*Illustrative measurements.*

The final three windows suggest that the application may have reached a reasonably stable performance state under this workload.

We should not conclude that 90 seconds is universally sufficient.

A different workload could activate previously cold methods and trigger further compilation.

---

## 8. Production implications: readiness is not warm-up

Consider a Kubernetes deployment:

```text
Container starts
      │
      ▼
Spring Boot initializes
      │
      ▼
Readiness probe succeeds
      │
      ▼
Production traffic begins
      │
      ▼
JIT compilation continues
```

A successful readiness probe means the application meets its configured readiness criteria.

It does not automatically mean the JVM is fully warmed up.

This distinction matters during rolling deployments.

Imagine replacing several mature application instances with newly started ones.

The new instances may temporarily require more CPU per request because their important execution paths have not yet been optimized.

If the environment is CPU-constrained, this can increase latency precisely when traffic shifts toward the new instances.

Possible approaches include representative warm-up traffic, gradual traffic introduction, and sufficient CPU capacity during startup.

However, artificially delaying readiness for a fixed duration is not automatically the correct solution. It may simply postpone traffic without exercising the code paths that actually need warming up.

---

## 9. A subtle point: warm-up is workload-specific

Consider an application with three major operations:

```text
Application
    │
    ├── Search API
    ├── Payment API
    └── Reporting API
```

If warm-up traffic exercises only the Search API, the JVM may optimize its search-related methods.

The Payment and Reporting APIs could remain comparatively cold.

Even if overall throughput and CPU utilization appear stable, the first substantial reporting workload might trigger:

- Additional class loading.
- New compilation tasks.
- Different allocation patterns.
- Additional GC activity.
- Lazy application initialization.

Therefore, a realistic warm-up strategy should represent the execution paths and request distributions that matter for the performance objective.

This is especially important when measuring tail latency.

---

## Mental model checkpoint

We can now connect the major JVM subsystems we've studied:

```text
                 Application startup
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
     Class loading   Interpreter    Heap allocation
          │              │              │
          ▼              ▼              ▼
     Metadata       Profiling       GC ergonomics
          │              │              │
          │              ▼              │
          │         C1 / C2 JIT          │
          │              │              │
          │              ▼              │
          │         Code Cache          │
          │              │              │
          └──────────────┼──────────────┘
                         │
                         ▼
                Application performance
                         │
                         ▼
              Representative workload
                         │
                         ▼
              Observed performance stability
```

### Key takeaway

**JVM warm-up is not a fixed-duration startup phase. It is the process through which the runtime adapts to an application's actual execution patterns.**

Class loading, profiling, JIT compilation, deoptimization, and GC ergonomics can all contribute.

A useful steady-state measurement requires a representative workload and stable application-level metrics—not simply waiting an arbitrary number of seconds.

### Next byte — #59: Class Data Sharing and AOT Caches — Reducing Repeated JVM Startup Work

We'll examine how JDK 25 can reuse information collected during previous application executions.

We'll connect Class Data Sharing, Ahead-of-Time class loading and linking, and AOT method profiling to the warm-up costs we've explored today.

The central question:

**If HotSpot must repeatedly load, link, profile, and optimize similar application code, how much of that work can be reused across JVM starts?**