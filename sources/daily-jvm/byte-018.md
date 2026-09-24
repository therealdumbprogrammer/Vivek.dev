# Daily JVM Byte #18 — Thread-local handshakes: coordination without stopping the whole JVM

Stable source ID: `byte-018`

Yesterday we covered **global safepoints**:

```text
request operation
      ↓
bring all Java threads to safe states
      ↓
perform VM operation
      ↓
resume everyone
```

But many runtime operations only need cooperation from **one thread** or a subset of threads. Stopping every Java thread would be unnecessary.

HotSpot's solution is the **thread-local handshake**.

Thread-local handshakes were introduced by JEP 312 and remain part of HotSpot's runtime machinery in JDK 25. They allow callbacks to be performed for individual Java threads while those threads are in states where the VM can safely operate on them.

## Why handshakes exist

Imagine a JVM with 500 application threads. HotSpot needs to perform an operation concerning Thread 217.

With only global safepoints, all 500 threads would need to participate. A handshake instead coordinates with Thread 217 while unrelated threads continue executing.

The central distinction is scope:

```text
global safepoint → coordinate all relevant Java threads
handshake        → coordinate selected Java thread(s)
```

The target must still reach, or already be in, a state in which HotSpot can safely perform the requested work. A handshake is therefore scoped coordination, not permission to inspect arbitrary machine state.

Modern HotSpot uses shared thread-local polling infrastructure for safepoints and handshakes. A pending operation arms per-thread polling state. A target executing Java code can observe the request at a suitable poll and enter the runtime. When the target is already in an appropriate safe state, HotSpot may be able to process suitable handshake work on its behalf; the target does not always literally execute the callback itself.

This narrower scope is the primary scalability benefit, especially in JVMs with many application threads. It does not mean zero pause or zero cost. Target threads can still be delayed, and a slow target can delay completion of the handshake operation.

Handshakes complement rather than replace global safepoints. Operations that require a globally consistent JVM state still require global coordination.

Observability work such as cooperative stack sampling is one example of why targeted coordination is useful. The mechanism also raises a further question in JDK 25: a Java `Thread` may be a platform thread or a virtual thread, while HotSpot's `JavaThread` represents an operating-system-backed execution thread. That distinction is the next byte.

## Source boundary

This archive preserves the supplied core and the reviewed technical decisions available from the originating conversation. The cached conversation preview ended partway through the original byte, so it does not claim to reproduce unavailable wording after that boundary. The integrated lesson is based on the reviewed draft requirements and revalidated against JEP 312 and JDK 25 HotSpot source.
