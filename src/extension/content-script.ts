import {
  ChromeLocalThreadStorage,
  HeuristicOutlineExtractor,
  ThroughlineCore,
  threadStorageKey
} from "../core";
import { ChatGPTContentAdapter } from "../adapters/chatgpt";
import type { IndexingStatus, SourceAnchor, TranscriptEvent } from "../core/types";

const storage = hasChromeStorage() ? new ChromeLocalThreadStorage(chrome.storage.local) : undefined;
const core = new ThroughlineCore({
  extractor: new HeuristicOutlineExtractor(),
  storage,
  maxEventsPerSegment: 6
});

const adapter = new ChatGPTContentAdapter(document, {
  onEvent: (event) => {
    void ingest([event]);
  },
  onStatus: (status) => {
    void persistStatus(status);
  }
});

const loaded = adapter.captureLoadedMessages({ backfillAttempted: true });
void ingest(loaded.events, loaded.state);
adapter.observeNewMessages();

if (hasChromeRuntime()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "throughline:jump-to-source") {
      return false;
    }

    const ok = adapter.jumpToSource(message.anchor as SourceAnchor);
    sendResponse({ ok });
    return false;
  });
}

async function ingest(events: TranscriptEvent[], status?: IndexingStatus): Promise<void> {
  const snapshot = await core.ingestEvents(events);
  if (snapshot && status) {
    snapshot.indexingStatus = status;
    await storage?.saveThread(snapshot);
  }
}

async function persistStatus(status: IndexingStatus): Promise<void> {
  const snapshot = core.getSnapshot();
  if (!snapshot) {
    return;
  }
  snapshot.indexingStatus = status;
  await storage?.saveThread(snapshot);
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.onMessage);
}

export { threadStorageKey };
