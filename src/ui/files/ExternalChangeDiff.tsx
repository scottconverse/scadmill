import { MergeView, getChunks, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { messages } from "../../messages/en";

type DiffLayout = "side-by-side" | "inline";

export interface ExternalChangeDiffProps {
  readonly diskSource: string;
  readonly localSource: string;
  readonly onApply: (source: string) => void;
  readonly beforeLabel?: string;
  readonly afterLabel?: string;
  readonly reviewOnly?: boolean;
}

const READ_ONLY_EDITOR = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
];

function chunkCount(view: EditorView): number {
  return getChunks(view.state)?.chunks.length ?? 0;
}

export function ExternalChangeDiff({
  diskSource,
  localSource,
  onApply,
  beforeLabel = messages.localVersion,
  afterLabel = messages.diskVersion,
  reviewOnly = false,
}: ExternalChangeDiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const inlineView = useRef<EditorView | null>(null);
  const [layout, setLayout] = useState<DiffLayout>("side-by-side");
  const [pendingChunks, setPendingChunks] = useState(0);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    parent.replaceChildren();
    inlineView.current = null;

    if (layout === "side-by-side") {
      setPendingChunks(0);
      const merge = new MergeView({
        a: {
          doc: localSource,
          extensions: [
            ...READ_ONLY_EDITOR,
            EditorView.contentAttributes.of({ "aria-label": beforeLabel }),
          ],
        },
        b: {
          doc: diskSource,
          extensions: [
            ...READ_ONLY_EDITOR,
            EditorView.contentAttributes.of({ "aria-label": afterLabel }),
          ],
        },
        parent,
      });
      return () => merge.destroy();
    }

    const controls = (type: "accept" | "reject", action: (event: MouseEvent) => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = type === "accept" ? messages.useDiskChange : messages.keepLocalChange;
      button.setAttribute("aria-label", button.textContent);
      button.addEventListener("click", action);
      return button;
    };
    const view = new EditorView({
      doc: diskSource,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": messages.inlineDiffEditor }),
        unifiedMergeView({
          original: localSource,
          mergeControls: controls,
          allowInlineDiffs: true,
          collapseUnchanged: { margin: 3, minSize: 8 },
        }),
        EditorView.updateListener.of((update) => setPendingChunks(chunkCount(update.view))),
      ],
      parent,
    });
    inlineView.current = view;
    setPendingChunks(chunkCount(view));
    return () => {
      inlineView.current = null;
      view.destroy();
    };
  }, [afterLabel, beforeLabel, diskSource, layout, localSource]);

  const apply = () => {
    const view = inlineView.current;
    if (!view || chunkCount(view) !== 0) return;
    onApply(view.state.doc.toString());
  };

  return (
    <div className="external-change-diff">
      {!reviewOnly && <fieldset className="external-change-diff-layout">
        <legend>{messages.diffLayout}</legend>
        <label>
          <input
            checked={layout === "side-by-side"}
            name="external-change-diff-layout"
            onChange={() => setLayout("side-by-side")}
            type="radio"
          />
          {messages.sideBySideDiff}
        </label>
        <label>
          <input
            checked={layout === "inline"}
            name="external-change-diff-layout"
            onChange={() => setLayout("inline")}
            type="radio"
          />
          {messages.inlineDiff}
        </label>
      </fieldset>}
      {layout === "side-by-side" && (
        <div aria-hidden="true" className="external-change-diff-headings">
          <span>{beforeLabel}</span>
          <span>{afterLabel}</span>
        </div>
      )}
      <div className="external-change-diff-editor" ref={host} />
      {!reviewOnly && layout === "inline" && (
        <div className="external-change-diff-actions">
          <p aria-live="polite">{messages.unresolvedDiffChunks(pendingChunks)}</p>
          <button disabled={pendingChunks !== 0} onClick={apply} type="button">
            {messages.applyHunkChoices}
          </button>
        </div>
      )}
    </div>
  );
}
