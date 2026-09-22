import { getCollection, type CollectionEntry } from 'astro:content';
const sampleTracks = [
  { slug: 'jvm', title: 'JVM from the inside out', type: 'Course', description: 'Build a mental model of the runtime, then follow memory from allocation to diagnosis.', note: 'Follow a guided sequence', lessons: [
    { slug: 'object-layout', title: 'Inside a Java object', group: 'Foundations', summary: 'A preview of object headers, mark words, class pointers, and alignment: why an object can occupy more memory than its fields suggest.', placeholder: true },
    { slug: 'gc-roots-reachability', title: 'References, reachability, and GC roots', group: 'Foundations', summary: 'A preview of how references connect objects, how GC roots provide starting points, and why reachability determines which objects must remain alive.', placeholder: true },
    { slug: 'gc-reclamation-strategies', title: 'Mark-Sweep vs Mark-Compact vs Copying GC', group: 'Foundations', summary: 'Foundational strategies for reclaiming memory.', placeholder: true },
    { slug: 'generational-gc', title: 'Generational garbage collection', group: 'Foundations', summary: 'A preview of Eden, Survivor spaces, the old generation, age, and promotion: how object lifetimes guide collection.', placeholder: true },
    { slug: 'write-barriers-card-tables', title: 'Write barriers, card tables, and remembered sets', group: 'Foundations', summary: 'A preview of how reference writes mark cards and maintain remembered metadata so collection can find incoming references without scanning the entire heap.', placeholder: true },
    { slug: 'tlabs-allocation', title: 'Allocation internals: TLABs and bump pointers', group: 'Foundations', summary: 'A preview of how thread-local allocation buffers and bump-pointer allocation let HotSpot allocate objects cheaply without one global allocation bottleneck.', placeholder: true },
    { slug: 'escape-analysis-scalar-replacement', title: 'Escape analysis and scalar replacement', group: 'Foundations', summary: 'A preview of how the JIT analyzes object use and can replace an object with its fields, removing some allocations entirely.', placeholder: true },
    { slug: 'class-loading-lifecycle', title: 'Class loading lifecycle', group: 'Foundations', summary: 'A preview of loading, linking, verification, preparation, resolution, and initialization: how class-file bytes become runtime types.', placeholder: true },
    { slug: 'constant-pool-symbolic-references', title: 'The constant pool and why JVM bytecode uses symbolic references', group: 'Foundations', summary: 'A preview of how numbered bytecode operands select class-file entries and become usable runtime relationships.', placeholder: true },
    { slug: 'stack-frames-operand-stack', title: 'Stack frames, local variables, and the operand stack', group: 'Foundations', summary: 'A preview of local variables, operands, method calls, and how the interpreter executes stack-based bytecode instruction by instruction.', placeholder: true },
    { slug: 'hotspot-interpreter', title: 'The HotSpot interpreter', group: 'Execution and JIT', summary: 'A preview of bytecode dispatch, interpreted frame state, and the execution profiles that guide JIT compilation.', placeholder: true },
    { slug: 'tiered-compilation', title: 'Tiered compilation: C1, C2, and compilation levels', group: 'Execution and JIT', summary: 'A preview of profiling compiled tiers, C1 and C2, compilation levels, and why HotSpot can compile a method more than once.', placeholder: true },
    { slug: 'speculative-optimization-deoptimization', title: 'Speculative optimization and deoptimization', group: 'Execution and JIT', summary: 'A preview of guarded runtime assumptions, optimized code invalidation, and how HotSpot recovers correct execution when observed behavior changes.', placeholder: true },
    { slug: 'code-cache', title: 'The Code Cache', group: 'Execution and JIT', summary: 'A preview of where JIT-generated native code lives, profiled and non-profiled code heaps, code lifetime, and how Code Cache pressure affects production performance.', placeholder: true },
    { slug: 'safepoints', title: 'Safepoints', group: 'Execution and JIT', summary: 'A preview of how HotSpot brings Java threads to known execution states for GC and other VM operations, and why time to safepoint differs from the operation itself.', placeholder: true },
  ]},
  { slug: 'kubernetes', hidden: true, title: 'A path into Kubernetes', type: 'Path', description: 'Connect the building blocks: from a running container to a service you can reach.', note: 'Work through connected milestones', lessons: [
    { slug: 'pods', title: 'Start with a Pod', group: 'Building blocks', summary: 'A Pod groups containers that share a network and storage context. It is the smallest deployable unit you manage in Kubernetes.', idea: 'Start with one running unit before thinking about a whole cluster.', example: 'kubectl get pods', exercise: 'Draw one Pod with two containers. Mark the resources they share.' },
    { slug: 'services', title: 'Give it a stable address', group: 'Connecting pieces', summary: 'A Service provides a stable way to reach a changing set of Pods. Labels connect the Service to its intended workloads.', idea: 'The destination can change while the address used by clients stays stable.', example: 'kubectl get services', exercise: 'What should happen to a client when one backing Pod is replaced?' },
  ]},
  { slug: 'agentic-systems', hidden: true, title: 'Notes on agentic systems', type: 'Collection', description: 'A small shelf of ideas about tools, context, and the boundaries of an agent.', note: 'Browse in any order', lessons: [
    { slug: 'tools', title: 'Tools as interfaces', group: 'Design notes', summary: 'A tool gives an agent a defined way to interact with a system. Clear inputs and results make that interaction easier to reason about.', idea: 'A useful tool has a narrow purpose and a result that makes the next decision clearer.', example: 'Input → Validate → Execute → Structured result', exercise: 'Describe a read-only tool for finding a document. What should it return when there are no matches?' },
    { slug: 'context', title: 'Working with context', group: 'Design notes', summary: 'Context is the information available at a decision point. Keeping relevant facts and decisions visible helps a task continue coherently.', idea: 'A short record of decisions can be more useful than an undifferentiated transcript.', example: 'Goal → Current state → Decisions → Next step', exercise: 'Write a four-line handoff for a task you are working on.' },
  ]},
];
export const lessonUrl = (track: string, lesson: string) => `/courses/${track}/${lesson}`;

export interface Lesson {
  slug: string; title: string; group: string; summary: string; order: number;
  draft: boolean; placeholder?: boolean; entry?: CollectionEntry<'lessons'>;
  idea?: string; example?: string; exercise?: string;
}
export interface Track { slug: string; title: string; type: string; description: string; note: string; lessons: Lesson[]; }
// Every route and navigation consumer uses the same draft visibility rule.
export async function getTracks(): Promise<Track[]> {
  const entries = await getCollection('lessons');
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.data.course}/${entry.data.lessonSlug}`;
    if (ids.has(entry.data.sourceByte) || routes.has(key)) throw new Error(`Duplicate lesson: ${key}`);
    if (!sampleTracks.some(t => t.slug === entry.data.course)) throw new Error(`Unknown course: ${entry.data.course}`);
    ids.add(entry.data.sourceByte); routes.add(key);
  }
  return sampleTracks.filter(track => !track.hidden).map(track => {
    const authored = entries.filter(e => e.data.course === track.slug);
    const firstDraftOrder = import.meta.env.DEV
      ? Number.POSITIVE_INFINITY
      : Math.min(...authored.filter(e => e.data.draft).map(e => e.data.order), Number.POSITIVE_INFINITY);
    const samples: Lesson[] = track.lessons
      .map((l, i) => ({...l, order: (i + 3) * 10, draft: false}))
      .filter(l => !authored.some(e => e.data.lessonSlug === l.slug))
      .filter(l => l.order < firstDraftOrder);
    const real: Lesson[] = authored.filter(e => import.meta.env.DEV || !e.data.draft)
      .map(entry => ({slug: entry.data.lessonSlug, title: entry.data.title,
        group: entry.data.module, summary: entry.data.summary, order: entry.data.order,
        draft: entry.data.draft, entry}));
    return {...track, lessons: [...samples, ...real].sort((a,b) => a.order - b.order || a.slug.localeCompare(b.slug))};
  });
}
export function trackCount(track: Track) {
  const draft = track.lessons.filter(l => l.draft).length;
  const sample = track.lessons.filter(l => !l.entry).length;
  return `${track.lessons.length} lessons${draft ? ` · ${draft} draft` : sample === track.lessons.length ? ' · sample content' : ''}`;
}

// Preserve course order and global lesson numbers while grouping by module metadata.
export function getLessonSections(track: Track) {
  const sections: { name: string; lessons: { lesson: Lesson; number: number }[] }[] = [];
  track.lessons.forEach((lesson, index) => {
    let section = sections.find(section => section.name === lesson.group);
    if (!section) { section = { name: lesson.group, lessons: [] }; sections.push(section); }
    section.lessons.push({ lesson, number: index + 1 });
  });
  return sections;
}
