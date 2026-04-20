"use client";

import type { Message as TMessage } from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";
import { memo, useCallback, useEffect, useState } from "react";
import equal from "fast-deep-equal";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, LightbulbIcon } from "lucide-react";
import { SpinnerIcon } from "./icons";
import { ToolInvocation } from "./tool-invocation";
import { CopyButton } from "./copy-button";

type VerificationAnnotation = {
  type: 'verification';
  score?: number;
  web_search_enabled?: boolean;
  allowed_domains?: string[];
  checks?: Array<{
    claim: string;
    label: 'SUPPORTED' | 'NOT_SUPPORTED' | 'CONTRADICTED' | string;
    confidence: number;
    rationale: string;
    sources: string[];
  }>;
};

interface ReasoningPart {
  type: "reasoning";
  reasoning: string;
  details: Array<{ type: "text"; text: string }>;
}

interface ReasoningMessagePartProps {
  part: ReasoningPart;
  isReasoning: boolean;
}

export function ReasoningMessagePart({
  part,
  isReasoning,
}: ReasoningMessagePartProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const memoizedSetIsExpanded = useCallback((value: boolean) => {
    setIsExpanded(value);
  }, []);

  useEffect(() => {
    memoizedSetIsExpanded(isReasoning);
  }, [isReasoning, memoizedSetIsExpanded]);

  return (
    <div className="flex flex-col mb-2 group">
      {isReasoning ? (
        <div className={cn(
          "flex items-center gap-2.5 rounded-full py-1.5 px-3",
          "bg-indigo-50/50 dark:bg-indigo-900/10 ocean:bg-indigo-900/10 text-indigo-700 dark:text-indigo-300",
          "border border-indigo-200/50 dark:border-indigo-700/20 ocean:border-indigo-700/20 w-fit"
        )}>
          <div className="animate-spin h-3.5 w-3.5">
            <SpinnerIcon />
          </div>
          <div className="text-xs font-medium tracking-tight">Thinking...</div>
        </div>
      ) : (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "flex items-center justify-between w-full",
            "rounded-md py-2 px-3 mb-0.5",
            "bg-muted/50 border border-border/60 hover:border-border/80",
            "transition-all duration-150 cursor-pointer",
            isExpanded ? "bg-muted border-primary/20" : ""
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex items-center justify-center w-6 h-6 rounded-full",
              "bg-amber-50 dark:bg-amber-900/20",
              "text-amber-600 dark:text-amber-400 ocean:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-700/30",
            )}>
              <LightbulbIcon className="h-3.5 w-3.5" />
            </div>
            <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
              Reasoning
              <span className="text-xs text-muted-foreground font-normal">
                (click to {isExpanded ? "hide" : "view"})
              </span>
            </div>
          </div>
          <div className={cn(
            "flex items-center justify-center",
            "rounded-full p-0.5 w-5 h-5",
            "text-muted-foreground hover:text-foreground",
            "bg-background/80 border border-border/50",
            "transition-colors",
          )}>
            {isExpanded ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronUpIcon className="h-3 w-3" />
            )}
          </div>
        </button>
      )}

      {isExpanded && (
        <div
          className={cn(
            "text-sm text-muted-foreground flex flex-col gap-2",
            "pl-3.5 ml-0.5 mt-1",
            "border-l border-amber-200/50 dark:border-amber-700/30"
          )}
        >
          <div className="text-xs text-muted-foreground/70 pl-1 font-medium">
            The assistant&apos;s thought process:
          </div>
          {part.details.map((detail, detailIndex) =>
            detail.type === "text" ? (
              <div key={detailIndex} className="px-2 py-1.5 bg-muted/10 rounded-md border border-border/30">
                <Markdown>{detail.text}</Markdown>
              </div>
            ) : (
              "<redacted>"
            ),
          )}
        </div>
      )}
    </div>
  );
}

const PurePreviewMessage = ({
  message,
  isLatestMessage,
  status,
  append,
}: {
  message: TMessage;
  isLoading: boolean;
  status: "error" | "submitted" | "streaming" | "ready";
  isLatestMessage: boolean;
  append: UseChatHelpers['append'];
}) => {
  const getMessageText = () => {
    if (!message.parts) return "";
    return message.parts
      .filter(part => part.type === "text")
      .map(part => (part.type === "text" ? part.text : ""))
      .join("\n\n");
  };

  const shouldShowCopyButton = message.role === "assistant" && (!isLatestMessage || status !== "streaming");

  const verification: VerificationAnnotation | null = (() => {
    const anns: any[] = Array.isArray((message as any).annotations)
      ? ((message as any).annotations as any[])
      : [];
    const v = anns.find((a) => a && a.type === 'verification');
    return (v as VerificationAnnotation) ?? null;
  })();

  const scoreBadge = (score?: number) => {
    const s = typeof score === 'number' ? score : undefined;
    if (s == null) return { label: 'N/A', cls: 'bg-muted text-muted-foreground border-border/60' };
    if (s >= 70) return { label: `${s}/100`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/30' };
    if (s >= 40) return { label: `${s}/100`, cls: 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/30' };
    return { label: `${s}/100`, cls: 'bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-700/30' };
  };

  return (
    <div
      className={cn(
        "w-full mx-auto px-4 group/message",
        message.role === "assistant" ? "mb-8" : "mb-6"
      )}
      data-role={message.role}
    >
      <div
        className={cn(
          "flex gap-4 w-full",
          message.role === "user" ? "ml-auto max-w-2xl w-fit" : ""
        )}
      >
        <div className="flex flex-col w-full space-y-3">
          {message.parts?.map((part, i) => {
            switch (part.type) {
              case "text":
                return (
                  <div
                    key={`message-part-${i}`}
                    className="flex flex-row gap-2 items-start w-full"
                  >
                    <div
                      className={cn("flex flex-col gap-3 w-full", {
                        "bg-secondary text-secondary-foreground px-4 py-3 rounded-2xl":
                          message.role === "user",
                      })}
                    >
                      <Markdown>{part.text}</Markdown>
                    </div>
                  </div>
                );
              case "tool-invocation":
                const { toolName, state, args } = part.toolInvocation;
                const result = 'result' in part.toolInvocation ? part.toolInvocation.result : null;
                
                return (
                  <ToolInvocation
                    key={`message-part-${i}`}
                    toolName={toolName}
                    state={state}
                    args={args}
                    result={result}
                    isLatestMessage={isLatestMessage}
                    status={status}
                    append={append}
                  />
                );
              case "reasoning":
                return (
                  <ReasoningMessagePart
                    key={`message-${i}`}
                    // @ts-expect-error part
                    part={part}
                    isReasoning={
                      (message.parts &&
                        status === "streaming" &&
                        i === message.parts.length - 1) ??
                      false
                    }
                  />
                );
              default:
                return null;
            }
          })}

          {message.role === 'assistant' && verification && (
            <div className={cn(
              "rounded-xl border border-border/60 bg-muted/30 px-4 py-3",
              "text-sm text-foreground"
            )}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">
                  Reliability score: <span className="font-bold">{verification.score ?? 'N/A'}/100</span>
                </div>
                <div className={cn(
                  "text-xs px-2 py-1 rounded-full border",
                  (verification.score ?? 0) >= 70
                    ? "bg-emerald-50/60 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-700/30"
                    : (verification.score ?? 0) >= 40
                      ? "bg-amber-50/60 text-amber-700 border-amber-200/60 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700/30"
                      : "bg-rose-50/60 text-rose-700 border-rose-200/60 dark:bg-rose-900/20 dark:text-rose-200 dark:border-rose-700/30"
                )}>
                  { (verification.score ?? 0) >= 70 ? 'khá tin cậy' : (verification.score ?? 0) >= 40 ? 'trung bình' : 'thấp' }
                </div>
              </div>

              <div className="mt-1 text-xs text-muted-foreground">
                Web search: {verification.web_search_enabled ? 'BẬT' : 'TẮT'}
              </div>

              {Array.isArray(verification.checks) && verification.checks.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Xem chi tiết kiểm chứng ({verification.checks.length} claim)
                  </summary>
                  <div className="mt-2 space-y-2">
                    {verification.checks.map((c, idx) => (
                      <div key={idx} className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold">#{idx + 1} • {c.label}</div>
                          <div className="text-[11px] text-muted-foreground">conf={Number(c.confidence ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="mt-1 text-sm">
                          {c.claim}
                        </div>
                        {c.rationale && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {c.rationale}
                          </div>
                        )}
                        {Array.isArray(c.sources) && c.sources.length > 0 && (
                          <div className="mt-1 text-[11px] text-muted-foreground break-words">
                            Nguồn: {c.sources.join(' • ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {shouldShowCopyButton && (
            <div className="flex justify-start mt-2">
              <CopyButton text={getMessageText()} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Message = memo(PurePreviewMessage, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.isLatestMessage !== nextProps.isLatestMessage) return false;
  if (prevProps.append !== nextProps.append) return false;
  if (prevProps.message.annotations !== nextProps.message.annotations) return false;
  // if (prevProps.message.id !== nextProps.message.id) return false;
  if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
  return true;
});