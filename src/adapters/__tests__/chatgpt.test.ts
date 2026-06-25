import { ChatGPTContentAdapter } from "../chatgpt";
import type { IndexingStatus, TranscriptEvent } from "../../core/types";

const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

const messageHtml = ({
  id,
  role,
  text,
  streaming = false
}: {
  id?: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}) => `
  <article
    ${id ? `data-message-id="${id}"` : ""}
    data-message-author-role="${role}"
    ${streaming ? 'data-streaming="true"' : ""}
  >
    <div data-message-content>${text}</div>
  </article>
`;

describe("ChatGPT content adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("captures loaded ChatGPT-like history as TranscriptEvent records", () => {
    document.body.innerHTML = `
      <main data-conversation-id="conv-chatgpt">
        ${messageHtml({ id: "u-1", role: "user", text: "What did we decide?" })}
        ${messageHtml({ id: "a-1", role: "assistant", text: "Decision: keep storage local." })}
      </main>
    `;
    const statuses: IndexingStatus[] = [];
    const adapter = new ChatGPTContentAdapter(document, {
      conversationId: "conv-chatgpt",
      now: () => "2026-06-24T20:00:00.000Z",
      onStatus: (status) => statuses.push(status)
    });

    const result = adapter.captureLoadedMessages();

    expect(statuses.map((status) => status.state)).toEqual(["indexing", "live"]);
    expect(result.state).toEqual({ state: "live" });
    expect(result.events).toMatchObject([
      {
        provider: "chatgpt",
        conversationId: "conv-chatgpt",
        messageId: "u-1",
        role: "user",
        text: "What did we decide?",
        anchor: { kind: "dom", locator: '[data-message-id="u-1"]' }
      },
      {
        messageId: "a-1",
        role: "assistant",
        text: "Decision: keep storage local.",
        anchor: { kind: "dom", locator: '[data-message-id="a-1"]' }
      }
    ]);
  });

  it("observes new and streaming assistant messages without losing updates", async () => {
    document.body.innerHTML = `<main data-conversation-id="conv-live"></main>`;
    const events: TranscriptEvent[] = [];
    const statuses: IndexingStatus[] = [];
    const adapter = new ChatGPTContentAdapter(document, {
      conversationId: "conv-live",
      now: () => "2026-06-24T20:00:00.000Z",
      onEvent: (event) => events.push(event),
      onStatus: (status) => statuses.push(status)
    });

    const observer = adapter.observeNewMessages();
    const stream = document.createElement("article");
    stream.setAttribute("data-message-id", "a-stream");
    stream.setAttribute("data-message-author-role", "assistant");
    stream.setAttribute("data-streaming", "true");
    stream.innerHTML = `<div data-message-content>Decision: start</div>`;
    document.querySelector("main")?.append(stream);
    await flushMutations();

    stream.querySelector("[data-message-content]")!.textContent = "Decision: start with a Chrome side panel.";
    stream.removeAttribute("data-streaming");
    await flushMutations();
    observer.disconnect();

    expect(events.map((event) => event.text)).toEqual([
      "Decision: start",
      "Decision: start with a Chrome side panel."
    ]);
    expect(statuses.some((status) => status.state === "partial")).toBe(true);
    expect(statuses.at(-1)).toEqual({ state: "live" });
  });

  it("ignores duplicate mutation events for unchanged messages", async () => {
    document.body.innerHTML = `<main data-conversation-id="conv-live"></main>`;
    const events: TranscriptEvent[] = [];
    const adapter = new ChatGPTContentAdapter(document, {
      conversationId: "conv-live",
      onEvent: (event) => events.push(event)
    });

    const observer = adapter.observeNewMessages();
    const assistant = document.createElement("article");
    assistant.setAttribute("data-message-id", "a-dup");
    assistant.setAttribute("data-message-author-role", "assistant");
    assistant.innerHTML = `<div data-message-content>Action: write tests.</div>`;
    document.querySelector("main")?.append(assistant);
    await flushMutations();

    assistant.setAttribute("data-unrelated", "changed");
    assistant.querySelector("[data-message-content]")?.append(document.createTextNode(""));
    await flushMutations();
    observer.disconnect();

    expect(events).toHaveLength(1);
    expect(events[0]?.messageId).toBe("a-dup");
  });

  it("marks capture partial when loaded history has missing IDs", () => {
    document.body.innerHTML = `
      <main data-conversation-id="conv-partial">
        ${messageHtml({ role: "assistant", text: "Question: what about old messages?" })}
      </main>
    `;
    const adapter = new ChatGPTContentAdapter(document, {
      conversationId: "conv-partial",
      now: () => "2026-06-24T20:00:00.000Z"
    });

    const result = adapter.captureLoadedMessages({ backfillAttempted: true });

    expect(result.state.state).toBe("partial");
    expect(result.state.detail).toMatch(/missing stable message id/i);
    expect(result.events[0]?.messageId).toMatch(/^generated-/);
    expect(result.events[0]?.anchor.locator).toMatch(/data-gpt-sidekick-generated-id/);
  });

  it("jumps back to a source anchor", () => {
    document.body.innerHTML = `
      <main data-conversation-id="conv-jump">
        ${messageHtml({ id: "a-1", role: "assistant", text: "Decision: source-link everything." })}
      </main>
    `;
    const adapter = new ChatGPTContentAdapter(document, { conversationId: "conv-jump" });
    const target = document.querySelector('[data-message-id="a-1"]') as HTMLElement & {
      scrollIntoView: ReturnType<typeof vi.fn>;
    };
    target.scrollIntoView = vi.fn();

    expect(adapter.jumpToSource({ kind: "dom", locator: '[data-message-id="a-1"]' })).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(target.dataset.gptSidekickActiveSource).toBe("true");
  });
});
