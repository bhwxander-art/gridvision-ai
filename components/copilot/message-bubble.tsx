"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Copy, Zap, User } from "lucide-react";
import { useState } from "react";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-sm font-semibold text-foreground/90">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-sm font-medium text-foreground/80">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="my-1 list-disc space-y-0.5 pl-4 text-sm">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-4 text-sm">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-muted-foreground">{children}</li>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-sm leading-relaxed text-muted-foreground last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <pre className="my-2 overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-xs text-cyan-300">
        <code>{children}</code>
      </pre>
    ) : (
      <code className="rounded bg-border/30 px-1 py-0.5 font-mono text-xs text-cyan-400">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
      {children}
    </blockquote>
  ),
};

export function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm border border-primary/20 bg-primary/10 px-4 py-3">
          <p className="text-sm text-foreground">{content}</p>
        </div>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/50">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10">
        <Zap className="h-3.5 w-3.5 text-cyan-400" />
      </div>
      <div className="group relative max-w-[85%] rounded-2xl rounded-tl-sm border border-border/40 bg-[#0d1219]/60 px-4 py-3">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
        {isStreaming && (
          <span className="inline-block animate-pulse text-cyan-400">▊</span>
        )}
        {!isStreaming && (
          <button
            onClick={handleCopy}
            className="absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? (
              <span className="text-xs text-emerald-400">Copied!</span>
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
