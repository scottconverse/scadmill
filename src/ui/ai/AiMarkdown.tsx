import { createElement, type ReactNode } from "react";

const INLINE_MARKUP = /(`[^`\r\n]+`|\*\*[^*\r\n]+\*\*|__[^_\r\n]+__|\*[^*\r\n]+\*|_[^_\r\n]+_|\[[^\]\r\n]+\]\([^\s)]+\))/gu;
const LINK = /^\[([^\]\r\n]+)\]\(([^\s)]+)\)$/u;
const FENCE_START = /^\s{0,3}```([^`\r\n]*)$/u;
const FENCE_END = /^\s{0,3}```\s*$/u;
const HEADING = /^(#{1,6})[\t ]+(.+)$/u;
const UNORDERED_ITEM = /^\s{0,3}[-+*][\t ]+(.+)$/u;
const ORDERED_ITEM = /^\s{0,3}\d+\.[\t ]+(.+)$/u;

function safeHttpUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const children: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of content.matchAll(INLINE_MARKUP)) {
    const start = match.index ?? cursor;
    if (start > cursor) children.push(content.slice(cursor, start));
    const token = match[0];
    const childKey = `${keyPrefix}-${key++}`;
    if (token.startsWith("`")) {
      children.push(<code key={childKey}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      children.push(
        <strong key={childKey}>{inlineMarkdown(token.slice(2, -2), `${childKey}-strong`)}</strong>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      children.push(
        <em key={childKey}>{inlineMarkdown(token.slice(1, -1), `${childKey}-em`)}</em>,
      );
    } else {
      const link = LINK.exec(token);
      const href = link ? safeHttpUrl(link[2]) : null;
      children.push(link && href ? (
        <a href={href} key={childKey} rel="noopener noreferrer" target="_blank">
          {inlineMarkdown(link[1], `${childKey}-link`)}
        </a>
      ) : token);
    }
    cursor = start + token.length;
  }
  if (cursor < content.length) children.push(content.slice(cursor));
  return children;
}

function startsBlock(line: string): boolean {
  return line.trim().length === 0
    || FENCE_START.test(line)
    || HEADING.test(line)
    || UNORDERED_ITEM.test(line)
    || ORDERED_ITEM.test(line);
}

export function AiMarkdown({ content }: { readonly content: string }) {
  const lines = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const children: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }
    const fence = FENCE_START.exec(line);
    if (fence) {
      const code: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !FENCE_END.test(lines[cursor])) {
        code.push(lines[cursor]);
        cursor += 1;
      }
      if (cursor < lines.length) cursor += 1;
      children.push(<pre key={`code-${key++}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const headingKey = `heading-${key++}`;
      children.push(createElement(
        `h${heading[1].length}`,
        { key: headingKey },
        inlineMarkdown(heading[2], headingKey),
      ));
      cursor += 1;
      continue;
    }
    const unordered = UNORDERED_ITEM.exec(line);
    if (unordered) {
      const listKey = `ul-${key++}`;
      const items: ReactNode[] = [];
      while (cursor < lines.length) {
        const item = UNORDERED_ITEM.exec(lines[cursor]);
        if (!item) break;
        const itemKey = `${listKey}-${items.length}`;
        items.push(<li key={itemKey}>{inlineMarkdown(item[1], itemKey)}</li>);
        cursor += 1;
      }
      children.push(<ul key={listKey}>{items}</ul>);
      continue;
    }
    const ordered = ORDERED_ITEM.exec(line);
    if (ordered) {
      const listKey = `ol-${key++}`;
      const items: ReactNode[] = [];
      while (cursor < lines.length) {
        const item = ORDERED_ITEM.exec(lines[cursor]);
        if (!item) break;
        const itemKey = `${listKey}-${items.length}`;
        items.push(<li key={itemKey}>{inlineMarkdown(item[1], itemKey)}</li>);
        cursor += 1;
      }
      children.push(<ol key={listKey}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [line.trim()];
    cursor += 1;
    while (cursor < lines.length && !startsBlock(lines[cursor])) {
      paragraph.push(lines[cursor].trim());
      cursor += 1;
    }
    const paragraphKey = `paragraph-${key++}`;
    children.push(
      <p key={paragraphKey}>{inlineMarkdown(paragraph.join(" "), paragraphKey)}</p>,
    );
  }
  return <>{children}</>;
}
