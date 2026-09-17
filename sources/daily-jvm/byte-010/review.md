# Byte 010 review

Source: originating ChatGPT conversation 6a996dbd-f8b0-83ee-a26a-3b05f1d7e4a3, “Save Backend Resource”. Full supplied byte preserved; reviewed draft retrieval truncated at the message limit. Final lesson reconstructs its ending from the complete byte and explicit user scope.

Placement: Foundations, order 100, after escape-analysis-scalar-replacement. Local draft; next preview class-file-runtime-constant-pool. Twelve original editable SVGs follow the 480px course convention.

Clarifications: metadata starts at loading, not after initialization; linking includes resolution but need not resolve every reference before initialization. Ordinary static defaults precede Java initialization expressions. ConstantValue assignment belongs before clinit in the specified initialization procedure; static final alone does not imply a constant variable. Name plus defining (not merely initiating) loader determines ordinary class identity. Class mirror and native HotSpot metadata are distinct. Unreachable loaders permit rather than guarantee unloading; hidden classes are outside the ordinary named-class model. Repeated retained generations or continued definition in a live loader can grow Metaspace. Reserved, committed and used memory differ.

Sources are linked in the lesson. No leak or performance benchmark is claimed.

- Verification: Astro diagnostics report 0 errors/warnings/hints; production build succeeds (69 pages). Draft route, production HTML links, and sitemap entry are excluded. All twelve SVGs parse, load, and were visually inspected. Desktop and 390px iframe views checked; final example has no horizontal code or page overflow. Sidebar selection, heading anchor, keyboard disclosure, overview, Lesson 9 ↔ 10 ↔ next preview and end-of-preview navigation verified. Fixed overview numbering from 010/011 to 10/11.
- Executed the initialization example on Homebrew OpenJDK HotSpot 25.0.2: loaded, 42, initializing, 42, 42. javap confirms ConstantValue for LIMIT and putstatic in the static initializer for count. A transient content-sync duplicate-ID warning occurred during dev/check; clean production sync succeeded and only one source entry exists per lesson.
- Local preview remains at http://127.0.0.1:4332/courses/jvm/class-loading-lifecycle. No commit, push, or deployment.

## Reader-feedback revision — 2026-09-14

- Explained the HotSpot term “mirror” only after grounding it in `Customer.class` and `getClass()`.
- Reduced the defining-loader rule to direct definition versus parent delegation.
- Reframed ConstantValue around the practical result that eligible compile-time constants can be read without class initialization.
- Added an executed `Checkout.total()` bytecode example: `invokestatic #7` refers to `Methodref Customer.fee:()I`; resolution turns that description into a checked runtime relationship.
- Reworked the loading, symbolic-resolution, and class-metadata diagrams. The final memory diagram is explicitly a simplified HotSpot view and distinguishes VM associations from ordinary Java reference fields.
- Rechecked the rendered draft at desktop and 390px widths. All lesson images load, the revised constant-pool block fits without horizontal overflow, and the memory example consistently shows initialization setting `nextId = 1` followed by the first allocation producing `id = 1` and `nextId = 2`.
