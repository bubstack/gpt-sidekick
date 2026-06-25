import { normalizeTranscriptEvent } from "../core";
import type { IndexingStatus, SourceAnchor, TranscriptEvent } from "../core/types";

type AdapterOptions = {
  conversationId?: string;
  now?: () => string;
  onEvent?: (event: TranscriptEvent) => void;
  onStatus?: (status: IndexingStatus) => void;
};

type CaptureOptions = {
  backfillAttempted?: boolean;
};

type ParsedMessage = {
  event: TranscriptEvent;
  missingStableId: boolean;
};

type CaptureResult = {
  events: TranscriptEvent[];
  state: IndexingStatus;
};

const MESSAGE_SELECTOR = [
  "article[data-message-author-role]",
  "[data-throughline-message]",
  "[data-message-id][data-message-author-role]",
  'article[data-testid^="conversation-turn-"]'
].join(",");

export class ChatGPTContentAdapter {
  private readonly seenFingerprints = new Map<string, string>();
  private readonly now: () => string;

  constructor(
    private readonly documentRef: Document,
    private readonly options: AdapterOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  captureLoadedMessages(options: CaptureOptions = {}): CaptureResult {
    this.reportStatus({ state: "indexing" });
    const parsed = this.scanMessages();
    for (const message of parsed) {
      this.seenFingerprints.set(message.event.messageId, fingerprint(message.event));
    }

    const state = this.captureStatus(parsed, options);
    this.reportStatus(state);
    return {
      events: parsed.map((message) => message.event),
      state
    };
  }

  observeNewMessages(): MutationObserver {
    const observer = new MutationObserver(() => {
      try {
        const parsed = this.scanMessages();
        const changed: TranscriptEvent[] = [];

        for (const message of parsed) {
          const nextFingerprint = fingerprint(message.event);
          if (this.seenFingerprints.get(message.event.messageId) === nextFingerprint) {
            continue;
          }

          this.seenFingerprints.set(message.event.messageId, nextFingerprint);
          changed.push(message.event);
          this.options.onEvent?.(message.event);
        }

        if (changed.some((event) => event.isPartial)) {
          this.reportStatus({ state: "partial", detail: "Streaming assistant message is still updating." });
        } else if (changed.length > 0) {
          this.reportStatus({ state: "live" });
        }
      } catch (error) {
        this.reportStatus({ state: "failed", detail: error instanceof Error ? error.message : String(error) });
      }
    });

    observer.observe(this.documentRef.body, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true
    });
    return observer;
  }

  jumpToSource(anchor: SourceAnchor): boolean {
    if (anchor.kind !== "dom") {
      return false;
    }

    const target = safeQuerySelector(this.documentRef, anchor.locator);
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    for (const active of this.documentRef.querySelectorAll('[data-throughline-active-source="true"]')) {
      delete (active as HTMLElement).dataset.throughlineActiveSource;
    }

    target.dataset.throughlineActiveSource = "true";
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  private scanMessages(): ParsedMessage[] {
    const elements = [...this.documentRef.querySelectorAll(MESSAGE_SELECTOR)]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element, index, elements) => elements.findIndex((candidate) => candidate === element) === index);

    return elements.map((element, index) => this.parseMessageElement(element, index)).filter(Boolean) as ParsedMessage[];
  }

  private parseMessageElement(element: HTMLElement, index: number): ParsedMessage | undefined {
    const role = readRole(element);
    const text = readMessageText(element);

    if (!role || !text.trim()) {
      return undefined;
    }

    const stableId = readStableMessageId(element);
    const missingStableId = !stableId;
    const messageId = stableId ?? generatedMessageId(this.conversationId(), role, text, index);
    const locator = stableId
      ? `[data-message-id="${cssEscape(stableId)}"]`
      : generatedAnchorLocator(element, messageId);
    const isPartial = element.getAttribute("data-streaming") === "true";

    return {
      missingStableId,
      event: normalizeTranscriptEvent({
        provider: "chatgpt",
        conversationId: this.conversationId(),
        messageId,
        role,
        text,
        createdAt: element.getAttribute("data-created-at") ?? this.now(),
        isPartial,
        anchor: {
          kind: "dom",
          locator
        }
      })
    };
  }

  private captureStatus(parsed: ParsedMessage[], options: CaptureOptions): IndexingStatus {
    if (parsed.some((message) => message.event.isPartial)) {
      return { state: "partial", detail: "Streaming assistant message is still updating." };
    }

    if (options.backfillAttempted || parsed.some((message) => message.missingStableId)) {
      const missing = parsed.some((message) => message.missingStableId);
      return {
        state: missing ? "partial" : "live",
        ...(missing ? { detail: "Loaded history has a missing stable message ID." } : {})
      };
    }

    return { state: "live" };
  }

  private conversationId(): string {
    return (
      this.options.conversationId ??
      this.documentRef.querySelector<HTMLElement>("[data-conversation-id]")?.dataset.conversationId ??
      this.documentRef.location?.pathname?.split("/").filter(Boolean).at(-1) ??
      "loaded-conversation"
    );
  }

  private reportStatus(status: IndexingStatus): void {
    this.options.onStatus?.(status);
  }
}

function readRole(element: HTMLElement): "user" | "assistant" | undefined {
  const role =
    element.getAttribute("data-message-author-role") ??
    element.querySelector<HTMLElement>("[data-message-author-role]")?.getAttribute("data-message-author-role");
  const normalized = role?.toLowerCase();
  return normalized === "user" || normalized === "assistant" ? normalized : undefined;
}

function readStableMessageId(element: HTMLElement): string | undefined {
  const id =
    element.getAttribute("data-message-id") ??
    element.querySelector<HTMLElement>("[data-message-id]")?.getAttribute("data-message-id");
  return id?.trim() || undefined;
}

function readMessageText(element: HTMLElement): string {
  const content =
    element.querySelector<HTMLElement>("[data-message-content]") ??
    element.querySelector<HTMLElement>('[data-testid="message-content"]') ??
    element.querySelector<HTMLElement>(".markdown") ??
    element;
  return content.textContent ?? "";
}

function generatedAnchorLocator(element: HTMLElement, messageId: string): string {
  element.dataset.throughlineGeneratedId = messageId;
  return `[data-throughline-generated-id="${cssEscape(messageId)}"]`;
}

function generatedMessageId(conversationId: string, role: string, text: string, index: number): string {
  return `generated-${hashString(`${conversationId}:${role}:${index}:${text}`)}`;
}

function fingerprint(event: TranscriptEvent): string {
  return `${event.role}:${event.text}:${event.isPartial ? "partial" : "complete"}`;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function safeQuerySelector(documentRef: Document, locator: string): Element | null {
  try {
    return documentRef.querySelector(locator);
  } catch {
    return null;
  }
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
