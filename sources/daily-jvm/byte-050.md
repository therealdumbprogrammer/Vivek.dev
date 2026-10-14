# Daily JVM Byte #50 — Measuring GC Overhead Beyond Pause Times

**Baseline:** JDK 25 LTS  
**Source:** originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3` and approved implementation brief.

The conversation reader exposes the original Byte #50 opening and the approved Lesson 50 draft only up to a bounded length. The complete original wording was not recoverable through that reader. The approved implementation brief is therefore the authoritative scope for the local lesson; this file records provenance rather than pretending to reproduce a truncated source.

Core scope: stop-the-world fraction; concurrent collector CPU; mutator barrier and allocation bookkeeping; allocation stalls; overlapping accounting; G1 versus ZGC illustrative comparison; `gc,cpu` User/Sys/Real; Unified Logging, JFR, JMC and timestamp correlation; controlled comparisons using throughput and application p99/p99.9.
