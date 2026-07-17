import type { ReactNode } from "react";

const FENCE = /```([^\r\n`]*)\r?\n([\s\S]*?)```/gu;

export function AiMarkdown({ content }: { readonly content: string }) {
  const children: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of content.matchAll(FENCE)) {
    const start = match.index ?? cursor;
    const prose = content.slice(cursor, start).trim();
    if (prose) children.push(<p key={`p-${key++}`}>{prose}</p>);
    children.push(<pre key={`c-${key++}`}><code>{match[2]}</code></pre>);
    cursor = start + match[0].length;
  }
  const tail = content.slice(cursor).trim();
  if (tail) children.push(<p key={`p-${key++}`}>{tail}</p>);
  return <>{children}</>;
}
