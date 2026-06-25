export type TranscriptRole = "user" | "assistant";

export type SourceAnchor = {
  kind: "dom" | "file" | "transcript";
  locator: string;
};

export type TranscriptEvent = {
  provider: string;
  conversationId: string;
  messageId: string;
  role: TranscriptRole;
  text: string;
  createdAt?: string;
  anchor: SourceAnchor;
  isPartial?: boolean;
};

export type TranscriptEventInput = Omit<TranscriptEvent, "provider" | "messageId" | "role" | "text"> & {
  provider: string;
  messageId: string;
  role: string;
  text: string;
};

export type ProviderCapabilities = {
  provider: string;
  liveCapture: boolean;
  readLoadedHistory: boolean;
  bestEffortBackfill: boolean;
  fullServerHistory: boolean;
  stableMessageIds: "yes" | "partial" | "no";
  sourceJump: boolean;
};

export type OutlineItemType =
  | "decision"
  | "action"
  | "question"
  | "artifact"
  | "code"
  | "correction"
  | "note";

export type EvidenceLink = {
  messageId: string;
  quote: string;
  offsetStart?: number;
  anchor: SourceAnchor;
};

export type OutlineItem = {
  id?: string;
  type: OutlineItemType;
  title: string;
  summary: string;
  evidence: EvidenceLink[];
  content?: string;
};

export type TranscriptSegment = {
  id: string;
  provider: string;
  conversationId: string;
  events: TranscriptEvent[];
  startMessageId: string;
  endMessageId: string;
};

export type IndexingStatus = {
  state: "idle" | "indexing" | "live" | "partial" | "failed";
  detail?: string;
};

export type ThreadSnapshot = {
  provider: string;
  conversationId: string;
  events: TranscriptEvent[];
  outline: OutlineItem[];
  updatedAt: string;
  indexingStatus?: IndexingStatus;
  segments?: TranscriptSegment[];
};

export type SidePanelState = {
  indexingStatus: IndexingStatus;
  outline: OutlineItem[];
};

export type OutlineExtractor = {
  extract(segment: TranscriptSegment): Promise<OutlineItem[]> | OutlineItem[];
};
