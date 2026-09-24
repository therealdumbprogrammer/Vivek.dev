# Byte 018 review notes

- Placement: Lesson 18, first lesson in `Threads and Synchronization`, after the global safepoint model in Lesson 17.
- Main objective: distinguish selected-thread handshake coordination from globally coordinated safepoints without describing a handshake as merely a small safepoint.
- Preserved boundaries: per-thread polling is shared infrastructure; target state must still be safe; the target does not always execute the callback; suitable work can be processed externally for a handshake-safe target; handshake scope reduces disruption but does not imply zero latency or zero cost; global operations still need safepoints.
- Observability: JFR cooperative sampling is one motivating example, not a survey of JFR internals.
- Next: platform threads versus virtual threads in JDK 25, especially Java `Thread`, HotSpot `JavaThread`, carrier, mounting, and unmounting.
- Source retrieval boundary: the originating ChatGPT preview exposed only the beginning of the byte and reviewed draft. The integrated lesson follows the explicit retained requirements and was checked against JEP 312 plus JDK 25 HotSpot sources.
