import { renderSidePanel } from "../sidepanel";
import type { OutlineItem, SidePanelState } from "../../core/types";

const anchor = (id: string) => ({
  kind: "dom" as const,
  locator: `[data-message-id="${id}"]`
});

const item = (overrides: Partial<OutlineItem>): OutlineItem => ({
  type: "decision",
  title: "Use local storage",
  summary: "Keep thread data on-device.",
  evidence: [{ messageId: "m-1", quote: "Local-first by default.", anchor: anchor("m-1") }],
  ...overrides
});

const state: SidePanelState = {
  indexingStatus: { state: "partial", detail: "Loaded history has missing stable message IDs." },
  outline: [
    item({ type: "decision", title: "Use local storage" }),
    item({
      type: "action",
      title: "Load unpacked extension",
      summary: "Load dist from chrome://extensions.",
      evidence: [{ messageId: "m-2", quote: "Load the built dist directory.", anchor: anchor("m-2") }]
    }),
    item({
      type: "code",
      title: "Storage adapter",
      summary: "const storage = new MemoryThreadStorage();",
      content: "const storage = new MemoryThreadStorage();",
      evidence: [{ messageId: "m-3", quote: "Create a local storage adapter.", anchor: anchor("m-3") }]
    })
  ]
};

describe("side panel UI", () => {
  beforeEach(() => {
    document.body.innerHTML = `<section id="app"></section>`;
  });

  it("renders indexing status", () => {
    renderSidePanel(document.querySelector("#app")!, state);

    expect(document.querySelector('[role="status"]')?.textContent).toContain("Partial");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("missing stable message IDs");
  });

  it("groups outline items by category", () => {
    renderSidePanel(document.querySelector("#app")!, state);

    expect(document.querySelector('[data-category="decision"]')?.textContent).toContain("Use local storage");
    expect(document.querySelector('[data-category="action"]')?.textContent).toContain("Load unpacked extension");
    expect(document.querySelector('[data-category="code"]')?.textContent).toContain("Storage adapter");
  });

  it("shows evidence quotes for every outline item", () => {
    renderSidePanel(document.querySelector("#app")!, state);

    expect(document.body.textContent).toContain("Local-first by default.");
    expect(document.body.textContent).toContain("Load the built dist directory.");
    expect(document.body.textContent).toContain("Create a local storage adapter.");
  });

  it("calls source-jump callbacks from evidence controls", () => {
    const onJumpToSource = vi.fn();
    renderSidePanel(document.querySelector("#app")!, state, { onJumpToSource });

    document.querySelector<HTMLButtonElement>('[aria-label="Jump to source for Use local storage"]')?.click();

    expect(onJumpToSource).toHaveBeenCalledWith(anchor("m-1"));
  });

  it("copies decisions, checklist, JSON, and code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    renderSidePanel(document.querySelector("#app")!, state, {
      clipboard: { writeText }
    });

    document.querySelector<HTMLButtonElement>('[aria-label="Copy decisions"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Copy checklist"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Copy JSON"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')?.click();

    expect(writeText).toHaveBeenNthCalledWith(1, expect.stringContaining("Use local storage"));
    expect(writeText).toHaveBeenNthCalledWith(2, expect.stringContaining("- [ ] Load unpacked extension"));
    expect(writeText).toHaveBeenNthCalledWith(3, expect.stringContaining('"title": "Use local storage"'));
    expect(writeText).toHaveBeenNthCalledWith(4, "const storage = new MemoryThreadStorage();");
  });
});
