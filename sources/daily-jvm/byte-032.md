# Daily JVM Byte #32 — Metaspace internals

Source: originating ChatGPT conversation `6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3`. The original Byte #32 text was not available in the bounded conversation retrieval. This file records the user-supplied reviewed scope; it does not claim to reproduce original wording.

Reviewed scope: class mirrors versus native metadata; class-loader-scoped lifetime; `ClassLoaderData` → `ClassLoaderMetaspace` → `MetaspaceArena` → Metachunks; class unloading and Elastic Metaspace; Compressed Class Space; retention paths and class-loader leaks; NMT, `jcmd`, JFR and heap-reachability diagnosis. Lesson 32 bridges to Code Cache internals.
