import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "./Card";

type AiBubbleProps = {
  children: ReactNode;
  /** Optional action row rendered below the content (buttons, chips). */
  actions?: ReactNode;
  className?: string;
};

/**
 * AI-content card — sage background, sparkle icon, AI-drafted body with an
 * optional action slot. The signature surface for everything Claude generates.
 */
export function AiBubble({ children, actions, className = "" }: AiBubbleProps) {
  return (
    <Card kind="ai" className={`p-2.5 ${className}`}>
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 flex-none text-ai-2" strokeWidth={1.5} />
        <div className="flex-1 text-[13px] text-ai-2">
          {children}
          {actions && <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </Card>
  );
}
