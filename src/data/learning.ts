import { getCollection, type CollectionEntry } from 'astro:content';
const sampleTracks = [
  { slug: 'jvm', title: 'JVM from the inside out', type: 'Course', description: 'Build a mental model of the runtime, then follow memory from allocation to diagnosis.', note: 'Follow a guided sequence', lessons: [
    { slug: 'memory', title: 'Heap and native memory', group: 'Foundations', summary: 'The heap holds Java objects, but it is only one part of a JVM process. Thread stacks, class metadata, and other native allocations also need space.', placeholder: true },
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
    const samples: Lesson[] = track.lessons
      .filter(l => !authored.some(e => e.data.lessonSlug === l.slug))
      .map((l, i) => ({...l, order: (i + 2) * 10, draft: false}));
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
