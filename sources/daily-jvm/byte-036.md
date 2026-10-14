# Daily JVM Byte #36 — JNI: crossing the Java/native boundary

This lesson adapts the reviewed Byte #36 draft. JNI is the standardized bridge between Java execution and native code. The core teaching problem is safely referring to Java objects whose lifetime and location remain under GC control while native code runs in-process.

Lesson 36: `jni-native-boundary`, order 360, module Native Memory, sourceByte `byte-036`, following Lesson 35 `direct-mapped-memory`.

The lesson preserves the key distinctions: opaque JNI-managed references versus raw object addresses; local versus global reference lifetime and GC roots; array access that may copy or expose original storage; constrained critical array access; native allocation leaks versus managed retention versus process crashes; and NMT scope versus whole-process RSS. Collector details are qualified as HotSpot implementation behavior.
