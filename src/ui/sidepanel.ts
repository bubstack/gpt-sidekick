import type { OutlineItem, OutlineItemType, SidePanelState, SourceAnchor } from "../core/types";

type ClipboardLike = {
  writeText(text: string): Promise<void> | void;
};

type SidePanelOptions = {
  onJumpToSource?: (anchor: SourceAnchor) => void;
  clipboard?: ClipboardLike;
};

const categoryOrder: OutlineItemType[] = ["decision", "action", "question", "artifact", "code", "correction", "note"];
const categoryLabels: Record<OutlineItemType, string> = {
  decision: "Decisions",
  action: "Actions",
  question: "Questions",
  artifact: "Artifacts",
  code: "Code",
  correction: "Corrections",
  note: "Notes"
};

export function renderSidePanel(root: Element, state: SidePanelState, options: SidePanelOptions = {}): void {
  const documentRef = root.ownerDocument;
  const clipboard = options.clipboard ?? documentRef.defaultView?.navigator.clipboard;
  root.replaceChildren();
  root.classList.add("throughline-panel");

  const header = documentRef.createElement("header");
  header.className = "panel-header";

  const title = documentRef.createElement("h1");
  title.textContent = "Throughline";
  header.append(title);
  header.append(renderStatus(documentRef, state));

  const actions = documentRef.createElement("nav");
  actions.className = "copy-actions";
  actions.append(
    copyButton(documentRef, "Copy decisions", "Decisions", () => copyText(clipboard, formatDecisions(state.outline))),
    copyButton(documentRef, "Copy checklist", "Checklist", () => copyText(clipboard, formatChecklist(state.outline))),
    copyButton(documentRef, "Copy JSON", "JSON", () => copyText(clipboard, JSON.stringify(state.outline, null, 2))),
    copyButton(documentRef, "Copy code", "Code", () => copyText(clipboard, formatCode(state.outline)))
  );

  const content = documentRef.createElement("main");
  content.className = "outline-groups";

  const grouped = groupByType(state.outline);
  for (const type of categoryOrder) {
    const items = grouped.get(type);
    if (!items?.length) {
      continue;
    }
    content.append(renderCategory(documentRef, type, items, options));
  }

  if (state.outline.length === 0) {
    const empty = documentRef.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No outline items yet.";
    content.append(empty);
  }

  root.append(header, actions, content);
}

function renderStatus(documentRef: Document, state: SidePanelState): HTMLElement {
  const status = documentRef.createElement("p");
  status.className = `indexing-status is-${state.indexingStatus.state}`;
  status.setAttribute("role", "status");
  const label = titleCase(state.indexingStatus.state);
  status.textContent = state.indexingStatus.detail ? `${label} - ${state.indexingStatus.detail}` : label;
  return status;
}

function renderCategory(
  documentRef: Document,
  type: OutlineItemType,
  items: OutlineItem[],
  options: SidePanelOptions
): HTMLElement {
  const section = documentRef.createElement("section");
  section.className = "outline-category";
  section.dataset.category = type;

  const heading = documentRef.createElement("h2");
  heading.textContent = categoryLabels[type];
  section.append(heading);

  const list = documentRef.createElement("ol");
  for (const item of items) {
    list.append(renderOutlineItem(documentRef, item, options));
  }
  section.append(list);
  return section;
}

function renderOutlineItem(documentRef: Document, item: OutlineItem, options: SidePanelOptions): HTMLElement {
  const listItem = documentRef.createElement("li");
  listItem.className = "outline-item";

  const title = documentRef.createElement("h3");
  title.textContent = item.title;

  const summary = documentRef.createElement("p");
  summary.className = "item-summary";
  summary.textContent = item.summary;

  const evidenceList = documentRef.createElement("ul");
  evidenceList.className = "evidence-list";

  for (const evidence of item.evidence) {
    const evidenceItem = documentRef.createElement("li");
    const quote = documentRef.createElement("blockquote");
    quote.textContent = evidence.quote;

    const jump = documentRef.createElement("button");
    jump.type = "button";
    jump.className = "icon-button";
    jump.setAttribute("aria-label", `Jump to source for ${item.title}`);
    jump.textContent = "Source";
    jump.addEventListener("click", () => options.onJumpToSource?.(evidence.anchor));

    evidenceItem.append(quote, jump);
    evidenceList.append(evidenceItem);
  }

  listItem.append(title, summary, evidenceList);
  return listItem;
}

function copyButton(documentRef: Document, ariaLabel: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.setAttribute("aria-label", ariaLabel);
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function groupByType(items: OutlineItem[]): Map<OutlineItemType, OutlineItem[]> {
  const grouped = new Map<OutlineItemType, OutlineItem[]>();
  for (const item of items) {
    grouped.set(item.type, [...(grouped.get(item.type) ?? []), item]);
  }
  return grouped;
}

function formatDecisions(items: OutlineItem[]): string {
  return items
    .filter((item) => item.type === "decision")
    .map((item) => `${item.title}\n${item.summary}`)
    .join("\n\n");
}

function formatChecklist(items: OutlineItem[]): string {
  return items
    .filter((item) => item.type === "action")
    .map((item) => `- [ ] ${item.title}`)
    .join("\n");
}

function formatCode(items: OutlineItem[]): string {
  return items
    .filter((item) => item.type === "code")
    .map((item) => item.content ?? item.summary)
    .join("\n\n");
}

function copyText(clipboard: ClipboardLike | undefined, text: string): void {
  void clipboard?.writeText(text);
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
