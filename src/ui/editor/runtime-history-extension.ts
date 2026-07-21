import { EditorState, type Extension, Transaction } from "@codemirror/state";

export const runtimeHistoryExtension: Extension = EditorState.transactionExtender.of(
  (transaction) => transaction.docChanged
    ? { annotations: Transaction.addToHistory.of(false) }
    : null,
);
