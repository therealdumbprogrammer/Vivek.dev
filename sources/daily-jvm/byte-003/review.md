# Daily JVM Byte #3 editorial review

Source: Save Backend Resource conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3. Original message and reviewed draft preserved. No source publication date inferred.

- Converted into Foundations Lesson 3, order 30, prerequisite memory, at /courses/jvm/object-layout. Kept local draft visibility per authoring workflow. Eight original editable SVGs teach anatomy, header, class metadata, reference vs object, alignment, compact headers, scale, and graph connections.
- Preserved the reviewed scope while connecting short fragments into the established course voice. Uses existing figures, full-size links, lesson-check and lesson-sources disclosures; no shared layout changes.
- Corrected the draft's implied physical layout: padding may occur between fields, not only at the end. The 24-byte User picture shows an illustrative three-byte internal gap before the reference. Explicit assumptions separate compressed object references from compressed class pointers. Reference fields are already part of instance-field storage.
- JDK 25 compact headers are a product feature, disabled by default, enabled with -XX:+UseCompactObjectHeaders without an experimental unlock. Verified official JEP 519 and JEP 450. JVM specification §2.7 leaves object representation implementation-specific; JOL documentation confirms offsets and layout must be inspected under the actual VM settings.
- Retained size is not equated with the reachable graph. Shared or cached Integer wrappers are qualified. 8 × 100 million = 800 decimal MB (about 763 MiB) is an assumed per-object saving, not a compact-header prediction.
- Shared navigation connects memory → object-layout → reachability locally. Sample positions are assigned before replacement filtering so reachability remains order 40. Lesson 2's closing prose names Lesson 3 without a hard-coded link to a production-excluded draft; development navigation provides the link.

## Validation

- OpenJDK 25.0.2 Homebrew, 64-bit: bounded 16–64 MiB heap, Instrumentation.getObjectSize on User and a version with another boolean. Both report 24 bytes with conventional and compact headers. Flag results and source retained here. This verifies shallow size, not field offsets; diagram offsets remain explicitly illustrative.
- Commands: javac -d work work/SizeProbe.java; package classes with MANIFEST.MF; java -Xms16m -Xmx64m -javaagent:work/size-probe.jar -cp work SizeProbe, repeated with -XX:+UseCompactObjectHeaders. Probe processes exited normally.
- Astro check: zero errors/warnings/hints; production build succeeds, 58 pages. An initial transient content-sync duplicate-ID warning for the edited memory source cleared during build; only one memory lesson source exists.
- Desktop 1440px and mobile 390px: course routes return 200, eight SVGs load, no page or code overflow, heading anchors resolve. Lesson reasoning disclosure opens with Space and has visible keyboard focus. Overview lists four entries with one draft; first and last navigation states work.
- Draft route absent from production output; production HTML/XML has no object-layout route links. Existing development server stays available at http://127.0.0.1:4321.
- Changes remain uncommitted on feature/learning-ui-experiment. Preserve existing Lesson 2 and CONTEXT.md edits. Next: local editorial review of Lesson 3 before acceptance/publication.
