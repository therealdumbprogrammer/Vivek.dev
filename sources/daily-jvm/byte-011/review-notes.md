# Lesson 11 review notes

Source: originating conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3, Daily JVM Byte #11. No source publication date supplied. Retrieved reviewed draft was truncated near the class-loading failures discussion; remaining requirements came from the explicit implementation request.

Adapted the draft to the established connected course prose and 480px SVG convention. New lesson remains a local draft. Clarified reference class versus declaring class, loader identity, pool index versus address/offset, runtime versus serialized pool, lazy resolution versus guaranteed first-use timing, and resolution versus virtual selection. NoClassDefFoundError can also follow failed initialization. Portability requires compatible versions and dependencies.

Verified javac and javap exercise on Homebrew OpenJDK HotSpot 25.0.2. Archived disassembly is actual output; production errors and other numbered pool entries are illustrative. Example.value was not invoked (name is null). No runtime resolution timing is inferred from javap.

## Beginner-first revision — 2026-09-15

Rebuilt the lesson around the verified `Example.java` and `javap -v` output. The reader now sees Java source, bytecode, and the relevant constant-pool rows before the lesson introduces symbolic references or runtime resolution. Bytecode offsets, local-variable slot numbers, pool indexes, cross-entry indexes, and runtime field layout are introduced separately. The same `Example.name` and `String.toUpperCase` references continue through pool lookup, portability, resolution, field layout, and interpreter execution; the separate Customer example remains only where virtual dispatch needs an override.
