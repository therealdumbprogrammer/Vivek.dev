# Daily JVM Byte #25 — G1 SATB: marking while the application keeps changing the heap

Source: originating “Save Backend Resource” conversation. The available preview of the supplied byte is bounded; the current user request and reviewed draft supply the full lesson requirements. No original date is asserted.

> Byte #24 introduced G1 concurrent marking while the application runs. How can GC trace an object graph that application threads change? At mark start Root → A → B. Before the marker reads A.child, the application writes A.child = C. A marker following only the current graph could miss B, which was reachable at mark start. SATB is a logical Snapshot-At-The-Beginning, not a physical heap copy. The pre-write barrier is concerned with B, the old overwritten value.

The remainder of the source byte was truncated by the conversation reader. See the reviewed draft and current implementation request for the accepted technical scope.
