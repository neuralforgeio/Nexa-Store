"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * MarkdownMessage — renderer markdown ringan khusus jawaban Nexa Bot (v1.18.0).
 *
 * Mendukung persis subset yang dipakai bot: heading #–######, **tebal**,
 * *miring*, `kode`, blok kode ```, daftar -/1., kutipan >, dan autolink URL.
 * Aman secara struktural: membangun elemen React langsung — tidak pernah
 * memakai dangerouslySetInnerHTML.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; text: string };

const BLOCK_START = /^(#{1,6}\s|>|[-*•]\s|\d+[.)]\s|```)/;

function parseBlocks(src: string): Block[] {
  const lines = String(src ?? "").replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // lewati penutup fence (atau EOF)
      if (buf.length > 0) blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: buf });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !BLOCK_START.test(lines[i] ?? "")) {
      buf.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "para", text: buf.join(" ") });
  }
  return blocks;
}

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|https?:\/\/[^\s<>()]+)/g;

/** Tokenisasi inline: tebal, kode, miring, URL. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${n}`;
    n += 1;
    if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded-md border border-border/60 bg-muted/70 px-1.5 py-px font-mono text-[11.5px] font-medium text-foreground"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("*")) {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    } else {
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {tok.length > 48 ? `${tok.slice(0, 45)}…` : tok}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownMessage({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn("space-y-2.5 text-[13px] leading-relaxed", className)}>
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        switch (b.kind) {
          case "heading": {
            if (b.level <= 2) {
              return (
                <p key={key} className="font-display text-sm font-semibold tracking-tight text-foreground">
                  {renderInline(b.text, key)}
                </p>
              );
            }
            return (
              <p
                key={key}
                className="flex items-center gap-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-primary"
              >
                <span aria-hidden="true" className="h-px w-3 bg-primary/50" />
                {renderInline(b.text, key)}
              </p>
            );
          }
          case "para":
            return (
              <p key={key} className="text-foreground/90">
                {renderInline(b.text, key)}
              </p>
            );
          case "ul":
            return (
              <ul key={key} className="space-y-1.5">
                {b.items.map((it, ii) => (
                  <li key={`${key}-${ii}`} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/80"
                    />
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${ii}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="space-y-1.5">
                {b.items.map((it, ii) => (
                  <li key={`${key}-${ii}`} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-px w-4 shrink-0 font-mono text-[11px] font-bold tabular text-primary"
                    >
                      {ii + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${ii}`)}</span>
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="rounded-lg border-l-2 border-primary/50 bg-primary/[0.06] px-3 py-2 text-[12.5px] text-muted-foreground"
              >
                {b.lines.map((l, li) => (
                  <p key={`${key}-q${li}`}>{renderInline(l, `${key}-q${li}`)}</p>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={key}
                className="scroll-slim overflow-x-auto rounded-lg border border-border/60 bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed"
              >
                <code>{b.text}</code>
              </pre>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
