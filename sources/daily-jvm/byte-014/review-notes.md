# Byte 014 review notes

Source: Save Backend Resource, conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3. Source byte retained verbatim; available reviewed assistant draft was truncated after “Suppose”. The user task supplies the intended final bridge. No missing source text was invented in the archive.

Lesson 14 uses JDK 25 HotSpot C1/C2 implementation references. Preserve the reviewed scope while using connected prose and diagrams in place of repeated text flowcharts. Local draft matches Lessons 10–13 and the course skill; the originating proposed draft had draft:false, but publication was not requested.

Clarifications: level 1 has no profiling; level 2 uses limited counters; level 3 uses fuller profiles. Tier policy can choose alternate paths based on queues and activity. C1/C2 are compilation-cost and optimization-depth trade-offs. Receiver frequencies are illustrative and do not guarantee inlining; specialization preserves fallback/deoptimization. Inlining can expose escape-analysis opportunities without guaranteeing scalar replacement. Installation, invalidation, active frames, and reclamation are distinct. C1 level 1 also belongs to non-profiled code. Code Cache segmentation is configuration-dependent, not a fixed universal size. Warm-up is per-path, workload-dependent, and not a measured smooth curve.

Code snippets and counts are illustrative; no benchmark was run. Primary links are included in the lesson.
