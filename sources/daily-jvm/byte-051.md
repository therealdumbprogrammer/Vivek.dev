# Daily JVM Byte #51 — GC Ergonomics

**Baseline:** JDK 25 LTS  
**Source:** approved reviewed Lesson 51 and implementation brief in originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`.

The original byte and complete reviewed draft were not available from the bounded conversation reader. This provenance note records the approved scope without inventing missing source wording.

Core scope: startup versus adaptive ergonomics; G1 young sizing and soft pause goal; mixed CSet cost and reclamation; adaptive IHOP using growth and marking time; parallel/concurrent worker maxima and active workers; Linux container CPU awareness; workload shift and bounded diagnostic lab.
