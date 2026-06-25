import { threadStorageKey, toSidePanelState } from "../core";
import type { SourceAnchor, ThreadSnapshot } from "../core/types";
import { renderSidePanel } from "../ui/sidepanel";
import "./sidepanel.css";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Missing side panel root.");
}

void renderFromStorage();

if (hasChromeStorage()) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const nextSnapshot = Object.entries(changes)
      .filter(([key]) => key.startsWith("throughline:thread:"))
      .map(([, change]) => change.newValue as ThreadSnapshot | undefined)
      .find(Boolean);

    if (nextSnapshot) {
      renderSnapshot(nextSnapshot);
    }
  });
}

async function renderFromStorage(): Promise<void> {
  if (!hasChromeStorage()) {
    renderSnapshot(undefined);
    return;
  }

  const stored = await chrome.storage.local.get(null);
  const latest = Object.entries(stored)
    .filter(([key]) => key.startsWith("throughline:thread:"))
    .map(([, value]) => value as ThreadSnapshot)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  renderSnapshot(latest);
}

function renderSnapshot(snapshot: ThreadSnapshot | undefined): void {
  renderSidePanel(root!, toSidePanelState(snapshot), {
    onJumpToSource: (anchor) => {
      void jumpToSource(anchor);
    }
  });
}

async function jumpToSource(anchor: SourceAnchor): Promise<void> {
  if (!hasChromeTabs()) {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await chrome.tabs.sendMessage(tab.id, { type: "throughline:jump-to-source", anchor });
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function hasChromeTabs(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.tabs?.query);
}

export { threadStorageKey };
