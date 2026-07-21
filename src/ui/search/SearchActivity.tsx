import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  planProjectTextReplacement,
  type ProjectTextReplacementPlan,
  searchProjectText,
  type ProjectTextSearchResult,
} from "../../application/navigation/project-text-search";
import type {
  OpenScadDefinition,
  OpenScadReference,
  OpenScadSourceLocation,
} from "../editor/openscad-navigation";
import "./search.css";

export interface SearchActivityProps {
  readonly activePath: string;
  readonly outline: readonly OpenScadDefinition[];
  readonly references: readonly OpenScadReference[];
  readonly loadSources: () => Promise<ReadonlyMap<string, string>>;
  readonly onApplyReplacements: (
    plan: ProjectTextReplacementPlan,
    originals: ReadonlyMap<string, string>,
  ) => Promise<void>;
  readonly onFindReferences: (path: string, position: number) => void;
  readonly onNavigate: (location: OpenScadSourceLocation) => Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Project search failed.";
}

export function SearchActivity({
  activePath,
  outline,
  references,
  loadSources,
  onApplyReplacements,
  onFindReferences,
  onNavigate,
}: SearchActivityProps) {
  const queryInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<ProjectTextSearchResult>();
  const [sources, setSources] = useState<ReadonlyMap<string, string>>();
  const [pendingPlan, setPendingPlan] = useState<ProjectTextReplacementPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const options = { query, caseSensitive, wholeWord };
  useEffect(() => queryInput.current?.focus(), []);

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    setPendingPlan(undefined);
    try {
      const loaded = await loadSources();
      setSources(loaded);
      setResult(searchProjectText(loaded, options));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const previewReplacement = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const loaded = sources ?? await loadSources();
      setSources(loaded);
      setPendingPlan(planProjectTextReplacement(loaded, { ...options, replacement }));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const applyReplacement = async () => {
    if (!pendingPlan || !sources) return;
    setBusy(true);
    setError(undefined);
    try {
      await onApplyReplacements(pendingPlan, sources);
      setPendingPlan(undefined);
      await search();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="search-activity">
      <form onSubmit={(event) => void search(event)}>
        <label>
          <span>Search project</span>
          <input
            onChange={(event) => { setQuery(event.target.value); setPendingPlan(undefined); }}
            placeholder="Text to find"
            type="search"
            ref={queryInput}
            value={query}
          />
        </label>
        <label>
          <span>Replace with</span>
          <input
            onChange={(event) => { setReplacement(event.target.value); setPendingPlan(undefined); }}
            placeholder="Replacement text"
            value={replacement}
          />
        </label>
        <div className="search-options">
          <label><input checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} type="checkbox" /> Match case</label>
          <label><input checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} type="checkbox" /> Whole word</label>
        </div>
        <div className="search-actions">
          <button disabled={busy || query.length === 0} type="submit">Find</button>
          {!pendingPlan && <button disabled={busy || query.length === 0} onClick={() => void previewReplacement()} type="button">Preview replace</button>}
          {pendingPlan && <button disabled={busy} onClick={() => void applyReplacement()} type="button">Replace {pendingPlan.matchCount} matches</button>}
        </div>
      </form>
      {error && <p className="search-error" role="alert">{error}</p>}
      {result && <p className="search-summary" role="status">{result.matches.length} matches in {result.searchedFiles} files{result.truncated ? " (limited)" : ""}</p>}
      {result && result.ignoredFiles.length > 0 && <p className="search-muted">Ignored {result.ignoredFiles.length} files using .gitignore and .scadmillignore.</p>}
      <ul className="search-results">
        {result?.matches.map((match) => (
          <li key={`${match.path}:${match.from}`}>
            <button onClick={() => void onNavigate(match)} type="button">
              <strong>{match.path}:{match.line}:{match.column}</strong>
              <span>{match.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <section className="symbol-outline" aria-label="Current file outline">
        <h3>Outline · {activePath}</h3>
        {outline.length === 0 && <p className="search-muted">No top-level symbols.</p>}
        <ul>
          {outline.map((symbol) => (
            <li key={`${symbol.symbolKind}:${symbol.from}`}>
              <button onClick={() => void onNavigate(symbol)} type="button">{symbol.label} <span>{symbol.symbolKind}</span></button>
              <button aria-label={`Find references to ${symbol.label}`} onClick={() => onFindReferences(symbol.path, symbol.from)} type="button">refs</button>
            </li>
          ))}
        </ul>
      </section>
      {references.length > 0 && <section className="symbol-references" aria-label="Symbol references">
        <h3>References</h3>
        <ul>
          {references.map((reference) => (
            <li key={`${reference.path}:${reference.from}`}><button onClick={() => void onNavigate(reference)} type="button">{reference.path}:{reference.line}:{reference.column}</button></li>
          ))}
        </ul>
      </section>}
    </div>
  );
}
