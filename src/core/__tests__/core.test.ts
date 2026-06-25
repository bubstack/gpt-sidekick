import {
  CHATGPT_WEB_CAPABILITIES,
  MemoryThreadStorage,
  createOutlineItem,
  groupTranscriptEvents,
  mergeOutlineCandidates,
  normalizeTranscriptEvent,
  redactTranscriptText
} from "../index";
import type { OutlineItem, TranscriptEvent } from "../types";

const anchor = (id: string) => ({
  kind: "dom" as const,
  locator: `[data-message-id="${id}"]`
});

const transcriptEvent = (overrides: Partial<TranscriptEvent> = {}) =>
  normalizeTranscriptEvent({
    provider: " ChatGPT ",
    conversationId: "conv-1",
    messageId: "m-1",
    role: "assistant",
    text: "  Decision: keep the extension local-first.  ",
    createdAt: "2026-06-24T20:00:00.000Z",
    anchor: anchor("m-1"),
    ...overrides
  });

describe("Throughline core", () => {
  it("normalizes TranscriptEvent records from adapter input", () => {
    const event = transcriptEvent({
      role: "user",
      text: "\n\n What did we decide? \n",
      messageId: " user-1 "
    });

    expect(event).toMatchObject({
      provider: "chatgpt",
      conversationId: "conv-1",
      messageId: "user-1",
      role: "user",
      text: "What did we decide?",
      createdAt: "2026-06-24T20:00:00.000Z",
      anchor: anchor("m-1")
    });
  });

  it("rejects outline items that do not carry concrete evidence", () => {
    expect(() =>
      createOutlineItem({
        type: "decision",
        title: "Use local storage",
        summary: "Thread data stays on-device.",
        evidence: []
      })
    ).toThrow(/evidence/i);

    expect(() =>
      createOutlineItem({
        type: "decision",
        title: "Use local storage",
        summary: "Thread data stays on-device.",
        evidence: [{ messageId: "m-1", quote: "", anchor: anchor("m-1") }]
      })
    ).toThrow(/quote/i);
  });

  it("groups transcript records into stable, ordered segments", () => {
    const events = ["m-1", "m-2", "m-3", "m-4", "m-5"].map((messageId, index) =>
      transcriptEvent({
        messageId,
        text: `Message ${index + 1}`,
        role: index % 2 === 0 ? "user" : "assistant",
        anchor: anchor(messageId),
        createdAt: `2026-06-24T20:0${index}:00.000Z`
      })
    );

    const segments = groupTranscriptEvents(events, { maxEventsPerSegment: 2 });

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.id)).toEqual([
      "conv-1-segment-0001",
      "conv-1-segment-0002",
      "conv-1-segment-0003"
    ]);
    expect(segments.map((segment) => segment.events.map((event) => event.messageId))).toEqual([
      ["m-1", "m-2"],
      ["m-3", "m-4"],
      ["m-5"]
    ]);
  });

  it("merges incremental outline candidates without duplicate evidence", () => {
    const existing = [
      createOutlineItem({
        type: "decision",
        title: "Use local storage",
        summary: "Persist thread state locally.",
        evidence: [{ messageId: "m-1", quote: "Local-first by default.", anchor: anchor("m-1") }]
      })
    ];
    const next = [
      createOutlineItem({
        type: "decision",
        title: "Use local storage",
        summary: "Persist thread state locally and avoid cloud sync.",
        evidence: [
          { messageId: "m-1", quote: "Local-first by default.", anchor: anchor("m-1") },
          { messageId: "m-2", quote: "No silent upload of conversation content.", anchor: anchor("m-2") }
        ]
      })
    ];

    const merged = mergeOutlineCandidates(existing, next);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toContain("avoid cloud sync");
    expect(merged[0]?.evidence).toHaveLength(2);
    expect(merged[0]?.evidence.map((item) => item.messageId)).toEqual(["m-1", "m-2"]);
  });

  it("preserves source anchors through segmenting and candidate merging", () => {
    const transcript = transcriptEvent({ messageId: "m-anchor", anchor: anchor("m-anchor") });
    const [segment] = groupTranscriptEvents([transcript]);
    const item = createOutlineItem({
      type: "action",
      title: "Load unpacked extension",
      summary: "The user should load the built dist directory.",
      evidence: [{ messageId: "m-anchor", quote: "Load dist in Chrome.", anchor: anchor("m-anchor") }]
    });

    const [merged] = mergeOutlineCandidates([], [item]);

    expect(segment?.events[0]?.anchor).toEqual(anchor("m-anchor"));
    expect(merged?.evidence[0]?.anchor).toEqual(anchor("m-anchor"));
  });

  it("models ChatGPT web capabilities without unsupported full-history claims", () => {
    expect(CHATGPT_WEB_CAPABILITIES).toEqual({
      provider: "chatgpt",
      liveCapture: true,
      readLoadedHistory: true,
      bestEffortBackfill: true,
      fullServerHistory: false,
      stableMessageIds: "partial",
      sourceJump: true
    });
  });

  it("keeps thread storage local-only", async () => {
    expect(() => new MemoryThreadStorage({ area: "sync" })).toThrow(/local-only/i);

    const storage = new MemoryThreadStorage({ area: "local" });
    const snapshot = {
      provider: "chatgpt",
      conversationId: "conv-1",
      events: [transcriptEvent()],
      outline: [
        createOutlineItem({
          type: "decision",
          title: "Stay local",
          summary: "Do not upload conversation content.",
          evidence: [{ messageId: "m-1", quote: "No silent upload.", anchor: anchor("m-1") }]
        })
      ],
      updatedAt: "2026-06-24T20:00:00.000Z"
    };

    await storage.saveThread(snapshot);

    expect(await storage.loadThread("conv-1")).toEqual(snapshot);
    expect(storage.exportDebugSnapshot()).toMatchObject({ transport: "local", area: "local" });
    expect(JSON.stringify(storage.exportDebugSnapshot())).not.toMatch(/https?:\/\//);
  });

  it("redacts sensitive text deterministically", () => {
    const input =
      "Email me at user@example.com with token Bearer abc.def.ghi and OpenAI key sk-test_1234567890abcdef.";

    const first = redactTranscriptText(input);
    const second = redactTranscriptText(input);

    expect(first).toBe(second);
    expect(first).toContain("[redacted:email]");
    expect(first).toContain("[redacted:token]");
    expect(first).toContain("[redacted:api-key]");
    expect(first).not.toContain("user@example.com");
    expect(first).not.toContain("abc.def.ghi");
    expect(first).not.toContain("sk-test_1234567890abcdef");
  });
});
