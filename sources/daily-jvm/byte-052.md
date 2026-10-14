# Daily JVM Byte #52 — JVM Memory Ergonomics in Containers

**Baseline:** JDK 25 LTS  
**Source:** approved reviewed Lesson 52 and implementation brief in originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`.

The original byte and complete reviewed draft were not available from the bounded conversation reader. This provenance note records the approved scope without inventing missing source wording.

Core scope: `-Xmx` versus whole-process and container budgets; reserved, committed, RSS and cgroup accounting; JDK 25 container-aware heap sizing; direct/native/stack memory; Java OOME versus Kubernetes OOMKilled; NMT, procfs, cgroup v2 and Kubernetes diagnostic layers; Lesson 53 as an upcoming text preview only.
