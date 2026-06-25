import type {
  EvidenceLink,
  IndexingStatus,
  OutlineExtractor,
  OutlineItem,
  OutlineItemType,
  ProviderCapabilities,
  ThreadSnapshot,
  TranscriptEvent,
  TranscriptEventInput,
  TranscriptSegment
} from "./types";

export type {
  EvidenceLink,
  IndexingStatus,
  OutlineExtractor,
  OutlineItem,
  OutlineItemType,
  ProviderCapabilities,
  SourceAnchor,
  ThreadSnapshot,
  TranscriptEvent,
  TranscriptEventInput,
  TranscriptRole,
  TranscriptSegment,
  SidePanelState
} from "./types";

export const CHATGPT_WEB_CAPABILITIES: ProviderCapabilities = {
  provider: "chatgpt",
  liveCapture: true,
  readLoadedHistory: true,
  bestEffortBackfill: true,
  fullServerHistory: false,
  stableMessageIds: "partial",
  sourceJump: true
};

const outlineTypePrefixes: Array<[OutlineItemType, RegExp]> = [
  ["decision", /^\s*(decision|decided)\s*:\s*(.+)$/i],
  ["action", /^\s*(action|todo|next action)\s*:\s*(.+)$/i],
  ["question", /^\s*(question|open question)\s*:\s*(.+)$/i],
  ["artifact", /^\s*(artifact|deliverable)\s*:\s*(.+)$/i],
  ["code", /^\s*(code|snippet)\s*:\s*(.+)$/i],
  ["correction", /^\s*(correction|changed direction)\s*:\s*(.+)$/i],
  ["note", /^\s*(note|fact|assumption)\s*:\s*(.+)$/i]
];

export function normalizeTranscriptEvent(input: TranscriptEventInput): TranscriptEvent {
  const provider = normalizeRequired(input.provider, "provider").toLowerCase();
  const conversationId = normalizeRequired(input.conversationId, "conversationId");
  const messageId = normalizeRequired(input.messageId, "messageId");
  const text = normalizeRequired(input.text, "text");
  const role = normalizeRole(input.role);

  if (!input.anchor || !input.anchor.kind || !input.anchor.locator.trim()) {
    throw new Error("TranscriptEvent requires a source anchor.");
  }

  return {
    provider,
    conversationId,
    messageId,
    role,
    text,
    createdAt: input.createdAt,
    anchor: {
      kind: input.anchor.kind,
      locator: input.anchor.locator.trim()
    },
    ...(input.isPartial === undefined ? {} : { isPartial: input.isPartial })
  };
}

export function createOutlineItem(item: OutlineItem): OutlineItem {
  const type = item.type;
  const title = normalizeRequired(item.title, "title");
  const summary = normalizeRequired(item.summary, "summary");
  const evidence = normalizeEvidence(item.evidence);
  const id = item.id ?? `${type}:${stableSlug(title)}`;

  return {
    id,
    type,
    title,
    summary,
    evidence,
    ...(item.content ? { content: item.content } : {})
  };
}

export function groupTranscriptEvents(
  events: TranscriptEvent[],
  options: { maxEventsPerSegment?: number } = {}
): TranscriptSegment[] {
  const maxEventsPerSegment = options.maxEventsPerSegment ?? 6;
  if (maxEventsPerSegment < 1) {
    throw new Error("maxEventsPerSegment must be at least 1.");
  }

  const normalizedEvents = events.map((event) => normalizeTranscriptEvent(event));
  const segments: TranscriptSegment[] = [];

  for (let index = 0; index < normalizedEvents.length; index += maxEventsPerSegment) {
    const chunk = normalizedEvents.slice(index, index + maxEventsPerSegment);
    const first = chunk[0];
    const last = chunk.at(-1);

    if (!first || !last) {
      continue;
    }

    segments.push({
      id: `${first.conversationId}-segment-${String(segments.length + 1).padStart(4, "0")}`,
      provider: first.provider,
      conversationId: first.conversationId,
      events: chunk,
      startMessageId: first.messageId,
      endMessageId: last.messageId
    });
  }

  return segments;
}

export function mergeOutlineCandidates(existing: OutlineItem[], candidates: OutlineItem[]): OutlineItem[] {
  const byKey = new Map<string, OutlineItem>();

  for (const item of existing) {
    const normalized = createOutlineItem(item);
    byKey.set(outlineKey(normalized), normalized);
  }

  for (const candidate of candidates) {
    const normalized = createOutlineItem(candidate);
    const key = outlineKey(normalized);
    const current = byKey.get(key);

    if (!current) {
      byKey.set(key, normalized);
      continue;
    }

    byKey.set(key, {
      ...current,
      summary: normalized.summary.length >= current.summary.length ? normalized.summary : current.summary,
      content: normalized.content ?? current.content,
      evidence: mergeEvidence(current.evidence, normalized.evidence)
    });
  }

  return [...byKey.values()];
}

export function redactTranscriptText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted:email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g, "[redacted:token]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted:api-key]");
}

export class MemoryThreadStorage {
  public readonly area: "local";
  private readonly threads = new Map<string, ThreadSnapshot>();

  constructor(options: { area: "local" | "sync" } = { area: "local" }) {
    if (options.area !== "local") {
      throw new Error("GPT-Sidekick storage is local-only for this prototype.");
    }
    this.area = "local";
  }

  async saveThread(snapshot: ThreadSnapshot): Promise<void> {
    this.threads.set(snapshot.conversationId, cloneSnapshot(snapshot));
  }

  async loadThread(conversationId: string): Promise<ThreadSnapshot | undefined> {
    const snapshot = this.threads.get(conversationId);
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  exportDebugSnapshot(): { transport: "local"; area: "local"; threadIds: string[] } {
    return {
      transport: "local",
      area: this.area,
      threadIds: [...this.threads.keys()]
    };
  }
}

export class ChromeLocalThreadStorage {
  public readonly area = "local";

  constructor(private readonly storageArea: Pick<chrome.storage.StorageArea, "get" | "set">) {}

  async saveThread(snapshot: ThreadSnapshot): Promise<void> {
    await this.storageArea.set({ [threadStorageKey(snapshot.conversationId)]: snapshot });
  }

  async loadThread(conversationId: string): Promise<ThreadSnapshot | undefined> {
    const result = await this.storageArea.get(threadStorageKey(conversationId));
    return result[threadStorageKey(conversationId)] as ThreadSnapshot | undefined;
  }
}

export class HeuristicOutlineExtractor implements OutlineExtractor {
  extract(segment: TranscriptSegment): OutlineItem[] {
    const items: OutlineItem[] = [];

    for (const event of segment.events) {
      const redactedText = redactTranscriptText(event.text);
      const lines = redactedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);

      for (const line of lines) {
        const parsed = parseOutlineLine(line);
        if (!parsed) {
          continue;
        }

        items.push(
          createOutlineItem({
            type: parsed.type,
            title: titleFromBody(parsed.body),
            summary: parsed.body,
            content: parsed.type === "code" ? parsed.body : undefined,
            evidence: [
              {
                messageId: event.messageId,
                quote: quoteFromLine(line),
                offsetStart: event.text.indexOf(line),
                anchor: event.anchor
              }
            ]
          })
        );
      }
    }

    return items;
  }
}

export class GPTSidekickCore {
  private snapshot: ThreadSnapshot | undefined;

  constructor(
    private readonly options: {
      extractor?: OutlineExtractor;
      storage?: Pick<MemoryThreadStorage | ChromeLocalThreadStorage, "saveThread" | "loadThread">;
      now?: () => string;
      maxEventsPerSegment?: number;
    } = {}
  ) {}

  async ingestEvents(events: TranscriptEvent[]): Promise<ThreadSnapshot | undefined> {
    if (events.length === 0) {
      return this.snapshot;
    }

    const normalizedEvents = events.map((event) => normalizeTranscriptEvent(event));
    const first = normalizedEvents[0];

    if (!first) {
      return this.snapshot;
    }

    const existing =
      this.snapshot ??
      (this.options.storage ? await this.options.storage.loadThread(first.conversationId) : undefined);
    const mergedEvents = mergeTranscriptEvents(existing?.events ?? [], normalizedEvents);
    const segments = groupTranscriptEvents(mergedEvents, {
      maxEventsPerSegment: this.options.maxEventsPerSegment
    });
    const affectedMessageIds = new Set(normalizedEvents.map((event) => event.messageId));
    const affectedSegments = withContextWindow(
      segments.filter((segment) => segment.events.some((event) => affectedMessageIds.has(event.messageId))),
      segments
    );
    const extractor = this.options.extractor ?? new HeuristicOutlineExtractor();
    const candidates: OutlineItem[] = [];

    for (const segment of affectedSegments) {
      candidates.push(...(await extractor.extract(segment)));
    }

    this.snapshot = {
      provider: first.provider,
      conversationId: first.conversationId,
      events: mergedEvents,
      segments,
      outline: mergeOutlineCandidates(existing?.outline ?? [], candidates),
      indexingStatus: statusFromEvents(normalizedEvents),
      updatedAt: this.options.now?.() ?? new Date().toISOString()
    };

    await this.options.storage?.saveThread(this.snapshot);
    return this.snapshot;
  }

  getSnapshot(): ThreadSnapshot | undefined {
    return this.snapshot ? cloneSnapshot(this.snapshot) : undefined;
  }
}

export function toSidePanelState(snapshot?: ThreadSnapshot): { indexingStatus: IndexingStatus; outline: OutlineItem[] } {
  return {
    indexingStatus: snapshot?.indexingStatus ?? { state: "idle", detail: "No conversation indexed yet." },
    outline: snapshot?.outline ?? []
  };
}

export function threadStorageKey(conversationId: string): string {
  return `gpt-sidekick:thread:${conversationId}`;
}

function normalizeRequired(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeRole(role: string): "user" | "assistant" {
  const normalized = normalizeRequired(role, "role").toLowerCase();
  if (normalized !== "user" && normalized !== "assistant") {
    throw new Error(`Unsupported transcript role: ${role}`);
  }
  return normalized;
}

function normalizeEvidence(evidence: EvidenceLink[]): EvidenceLink[] {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error("Outline items require at least one evidence link.");
  }

  return evidence.map((item) => {
    const messageId = normalizeRequired(item.messageId, "evidence.messageId");
    const quote = normalizeRequired(item.quote, "evidence quote");

    if (!item.anchor || !item.anchor.locator.trim()) {
      throw new Error("Evidence links require source anchors.");
    }

    return {
      messageId,
      quote,
      ...(item.offsetStart === undefined ? {} : { offsetStart: item.offsetStart }),
      anchor: {
        kind: item.anchor.kind,
        locator: item.anchor.locator.trim()
      }
    };
  });
}

function mergeEvidence(existing: EvidenceLink[], next: EvidenceLink[]): EvidenceLink[] {
  const seen = new Set<string>();
  const merged: EvidenceLink[] = [];

  for (const item of [...existing, ...next]) {
    const key = `${item.messageId}:${item.offsetStart ?? ""}:${item.quote}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mergeTranscriptEvents(existing: TranscriptEvent[], incoming: TranscriptEvent[]): TranscriptEvent[] {
  const byId = new Map(existing.map((event) => [event.messageId, event]));

  for (const event of incoming) {
    byId.set(event.messageId, event);
  }

  return [...byId.values()];
}

function withContextWindow(affected: TranscriptSegment[], all: TranscriptSegment[]): TranscriptSegment[] {
  const indexes = new Set<number>();
  for (const segment of affected) {
    const index = all.findIndex((candidate) => candidate.id === segment.id);
    if (index >= 0) {
      indexes.add(Math.max(0, index - 1));
      indexes.add(index);
    }
  }
  return [...indexes].sort((a, b) => a - b).map((index) => all[index]).filter((segment): segment is TranscriptSegment => Boolean(segment));
}

function statusFromEvents(events: TranscriptEvent[]): IndexingStatus {
  return events.some((event) => event.isPartial)
    ? { state: "partial", detail: "Streaming or unstable message content is still being indexed." }
    : { state: "live" };
}

function parseOutlineLine(line: string): { type: OutlineItemType; body: string } | undefined {
  for (const [type, pattern] of outlineTypePrefixes) {
    const match = line.match(pattern);
    if (match?.[2]) {
      return { type, body: match[2].trim() };
    }
  }
  return undefined;
}

function quoteFromLine(line: string): string {
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

function titleFromBody(body: string): string {
  const firstSentence = body.split(/[.!?]\s/)[0] ?? body;
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69)}...` : firstSentence;
}

function outlineKey(item: OutlineItem): string {
  return `${item.type}:${item.title.trim().toLowerCase()}`;
}

function stableSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cloneSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ThreadSnapshot;
}
