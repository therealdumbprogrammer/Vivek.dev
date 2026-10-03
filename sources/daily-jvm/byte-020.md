# Daily JVM Byte #20 — synchronized internals: lightweight locking and monitor inflation

Yesterday we separated **Java thread identity** from the OS thread using virtual threads. Today we move to synchronization: what HotSpot actually does when you write:

```
synchronized (account) {
    account.update();
}
```

At the JVM bytecode level, synchronization uses monitor semantics. Every identity object can act as a monitor, and entering a synchronized region acquires that object's monitor lock. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/MonitorInfo.html?utm_source=chatgpt.com)

The important JDK 25 point is that **acquiring `synchronized` does not normally mean immediately allocating a heavyweight `ObjectMonitor`.**

### 1. Why HotSpot needs a fast path

Most locks are uncontended:

```
Thread A
   ↓
lock
   ↓
critical section
   ↓
unlock
```

Nobody else wants the lock.

Using an OS-level blocking mechanism for every such acquisition would be unnecessarily expensive. HotSpot therefore starts with a cheap **lightweight lock** and escalates only when necessary.

Conceptually:

```
synchronized
     ↓
lightweight locking
     │
     ├── uncontended → cheap fast path
     │
     └── contention / required monitor features
                    ↓
             ObjectMonitor
```

Lightweight locking is the default locking mode used by modern HotSpot, including the implementation underlying JDK 25. [OpenJDK Mail](https://mail.openjdk.org/pipermail/core-libs-dev/2024-November/134177.html?utm_source=chatgpt.com)

### 2. Connection to the object header

Recall our earlier object-layout lesson:

```
Object
┌─────────────────┐
│ Mark Word       │
├─────────────────┤
│ Klass metadata  │
├─────────────────┤
│ fields ...      │
└─────────────────┘
```

Historically, HotSpot's older **stack-locking** scheme replaced much of the object's mark word with a pointer into the owning thread's stack.

Modern lightweight locking deliberately avoids that design. OpenJDK describes the motivation as retaining fast uncontended locking while avoiding the old mark-word overloading. [OpenJDK Mail](https://mail.openjdk.org/pipermail/shenandoah-dev/2022-October/017502.html?utm_source=chatgpt.com)

The simplified JDK 25 model is:

```
Object Mark Word
       │
       └── lock-state bits

Thread
┌──────────────────┐
│ LockStack        │
│ ...              │
│ account oop      │
└──────────────────┘
```

On a successful lightweight acquisition, HotSpot records the locked object in the thread's lock stack and changes the object's lock-state bits.

So do **not** use the old mental model:

```
Mark Word → pointer to BasicLock on thread stack
```

for the normal JDK 25 lightweight-locking path.

### 3. Uncontended acquisition

Conceptually, Thread A executes:

```
monitorenter account
```

HotSpot tries something roughly like:

```
read account Mark Word
        ↓
is unlocked?
        ↓ yes
atomically change lock state
        ↓
record account in Thread A's LockStack
        ↓
enter critical section
```

The atomic transition matters because two threads might attempt acquisition simultaneously:

```
        account

Thread A ── CAS ──┐
                  ├── only one succeeds
Thread B ── CAS ──┘
```

The exact generated sequence is architecture- and runtime-dependent, but the important principle is:

> The common uncontended case stays in a small, inexpensive HotSpot fast path.

### 4. Reentrancy

Java intrinsic monitors are reentrant:

```
synchronized (x) {
    foo(x);
}

void foo(Object x) {
    synchronized (x) {
        ...
    }
}
```

The same thread may acquire `x` again.

Conceptually:

```
Thread A owns x

A → lock(x)
      ↓
already owned by A
      ↓
allow recursive acquisition
```

HotSpot's lock bookkeeping must therefore distinguish:

```
another thread owns it
```

from:

```
I already own it
```

and maintain correct recursion semantics.

### 5. Contention changes the problem

Now suppose:

```
Thread A → owns account

Thread B → monitorenter account
```

Thread B cannot enter.

At this point HotSpot may need richer state than the lightweight representation conveniently provides:

```
owner
waiting threads
entry queues
wait()/notify() state
recursion
parking/wakeup coordination
```

HotSpot can **inflate** the lock into an `ObjectMonitor`.

Conceptually:

```
lightweight lock
      ↓
contention / monitor requirements
      ↓
┌────────────────────┐
│ ObjectMonitor      │
│                    │
│ owner              │
│ recursion state    │
│ contenders         │
│ wait set           │
│ ...                │
└────────────────────┘
```

The object's locking state then identifies the inflated-monitor representation.

This is why the term **monitor inflation** appears frequently in HotSpot diagnostics.

### 6. Waiting for the lock vs `Object.wait()`

These are related but different.

Thread B doing:

```
synchronized (x) {
```

while A owns `x` is waiting to **acquire the monitor**.

But:

```
synchronized (x) {
    x.wait();
}
```

means:

```
I already own x
     ↓
release monitor
     ↓
enter x's wait set
     ↓
sleep until notification/interruption/etc.
     ↓
reacquire monitor before wait() returns
```

The monitor therefore supports both:

```
entry contention
```

and:

```
wait/notify coordination
```

Every identity object has an associated wait set manipulated by `wait`, `notify`, and `notifyAll`. [OpenJDK](https://cr.openjdk.org/~dlsmith/jep401/jep401-20250118/specs/value-objects-jls.html?utm_source=chatgpt.com)

### 7. What about virtual threads?

This is where yesterday's lesson connects directly.

Before JEP 491, holding an intrinsic monitor was a major virtual-thread limitation: blocking while inside `synchronized` could pin the virtual thread to its carrier.

That is no longer the normal JDK 25 behavior.

The implementation changed lightweight locking so that the virtual thread's lock state can move with its continuation when it unmounts; OpenJDK's implementation describes copying the carrier's lock-stack object references into the virtual thread's stack chunk during freezing. [OpenJDK Mail](https://mail.openjdk.org/pipermail/core-libs-dev/2024-November/134177.html?utm_source=chatgpt.com)

So on JDK 25:

```
virtual thread
      ↓
synchronized
      ↓
blocking operation
      ↓
can normally unmount
      ↓
carrier can execute something else
```

This is a substantial difference from older Loom material.

### 8. Production implications

The important performance distinction is not:

```
synchronized = slow
```

It is:

```
uncontended synchronized
        ↓
very cheap lightweight path

heavily contended synchronized
        ↓
monitor inflation
        ↓
waiting / scheduling / cache coherence
        ↓
potential throughput + latency cost
```

Therefore, when diagnosing synchronization problems, look for **contention**, not merely the presence of `synchronized`.

Thread dumps and management APIs expose monitor ownership and blocked threads; JDK 25's `ThreadInfo` can report both locked object monitors and ownable synchronizers. [Oracle Docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadInfo.html?utm_source=chatgpt.com)

### Mental model checkpoint

We can now connect several earlier lessons:

```
Java object
   │
   └── Mark Word
          │
          ▼
   lightweight lock state
          │
          ▼
Thread LockStack
          │
          │ contention / richer semantics
          ▼
     ObjectMonitor
          │
     ┌────┴────┐
     │         │
 contenders  wait set
```

And with virtual threads:

```
VirtualThread
     │
continuation
     │
stack chunks + lock state
     │
mount / unmount
     ▼
carrier thread
```

The key JDK 25 mental model is:

> `synchronized` is a language/JVM monitor abstraction; an `ObjectMonitor` is one HotSpot runtime representation used when the cheap lightweight-locking representation is insufficient.

**Next byte:** **`ReentrantLock`, AQS, and `LockSupport.park()` — how Java-level synchronizers differ internally from intrinsic monitors, why AQS uses a queue, and where parking enters the picture.**
