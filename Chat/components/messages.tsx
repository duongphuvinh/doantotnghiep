import type { Message as TMessage, UseChatHelpers } from "@ai-sdk/react";
import { Message } from "./message";
import { useScrollToBottom } from "@/lib/hooks/use-scroll-to-bottom";
import { Loader2 } from "lucide-react";

export const Messages = ({
  messages,
  isLoading,
  status,
  append,
}: {
  messages: TMessage[];
  isLoading: boolean;
  status: "error" | "submitted" | "streaming" | "ready";
  append: UseChatHelpers['append'];
}) => {
  const [containerRef, endRef] = useScrollToBottom();
  const latestMessage = messages[messages.length - 1];
  const shouldShowLoading =
    isLoading && (status === "submitted" || latestMessage?.role === "user");
  
  return (
    <div
      className="h-full overflow-y-auto no-scrollbar"
      ref={containerRef}
    >
      <div className="max-w-lg sm:max-w-3xl mx-auto py-4">
        {messages.map((m, i) => (
          <Message
            key={i}
            isLatestMessage={i === messages.length - 1}
            isLoading={isLoading}
            message={m}
            status={status}
            append={append}
          />
        ))}
        {shouldShowLoading && (
          <div
            className="w-full mx-auto px-4 mb-8"
            aria-live="polite"
            aria-label="Chatbot đang xử lý câu hỏi"
          >
            <div className="flex items-center gap-3 w-fit max-w-full rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">
                  Đang tìm kiếm và tổng hợp thông tin...
                </span>
                <span className="text-xs">
                  Chatbot đang kiểm tra dữ liệu nội bộ và nguồn tham khảo phù hợp.
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="h-1" ref={endRef} />
      </div>
    </div>
  );
};
