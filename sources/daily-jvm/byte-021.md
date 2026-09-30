# Daily JVM Byte #21 — ReentrantLock, AQS, and parking

Source: reviewed Daily JVM Byte #21 in the originating “Save Backend Resource” conversation. No publication date was provided.

The byte closes Threads and Synchronization by contrasting the JVM monitor abstraction used by `synchronized` with `ReentrantLock`, a library synchronizer built primarily on AbstractQueuedSynchronizer (AQS). It covers the motivation for explicit lock APIs, AQS state/owner/queue responsibilities, uncontended CAS, hold-count reentrancy, contention and parking, Condition queues, fairness, virtual-thread parking, thread-dump diagnostics, production contention guidance, reasoning checks, and a transition into Garbage Collection foundations.

Technical refinements retained from the reviewed draft: state is subclass-defined; the AQS queue is not a universal FIFO promise; LockSupport has one non-accumulating permit; park may return spuriously or due to interrupt; unpark does not transfer ownership; Condition signal transfers eligibility toward lock reacquisition; and JDK 25 virtual-thread parking ordinarily suspends the virtual thread while releasing its carrier.
