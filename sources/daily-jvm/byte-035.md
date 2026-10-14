# Daily JVM Byte #35 — Direct and mapped memory: off-heap memory outside `-Xmx`

Source: the user-supplied Byte #35 and reviewed Lesson 35 draft in the originating “Save Backend Resource” conversation (conversation ID `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`). The source introduced `ByteBuffer.allocateDirect(...)` and `FileChannel.map(...)`, direct-buffer I/O and cleaner lifetime, `MaxDirectMemorySize`, mapped-file virtual versus resident memory, heap-dump scope, BufferPoolMXBean/NMT/OS diagnostics, pressure modes, whole-process budgeting, and the bridge to JNI.

The converted lesson incorporates the reviewed technical requirements and source-conversation clarifications. Its examples and diagrams are explanatory, not measured process data.
