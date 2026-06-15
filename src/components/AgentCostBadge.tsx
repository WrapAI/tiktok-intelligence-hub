import { useEffect, useState } from "react";
import type { AgentCostBreakdown } from "../hub";

type Props = {
  action: "generate_script" | "generate_daily_plan" | "agent_chat";
  totalVideos?: number;
  durationSeconds?: number;
  messageChars?: number;
  actualCost?: AgentCostBreakdown | null;
};

export default function AgentCostBadge({
  action,
  totalVideos,
  durationSeconds,
  messageChars,
  actualCost,
}: Props) {
  const [estimate, setEstimate] = useState<AgentCostBreakdown | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.hub
      .estimateAgentCost({
        action,
        totalVideos,
        durationSeconds,
        messageChars,
      })
      .then((res) => {
        if (!cancelled && res.ok && res.cost) setEstimate(res.cost);
      });
    return () => {
      cancelled = true;
    };
  }, [action, totalVideos, durationSeconds, messageChars]);

  const cost = actualCost || estimate;
  if (!cost) return null;

  const usdStr = cost.totalUsd < 0.01
    ? `$${cost.totalUsd.toFixed(3)}`
    : `$${cost.totalUsd.toFixed(2)}`;

  return (
    <span
      className="agent-cost-badge"
      title={`${actualCost ? "Actual" : "Estimated"} Anthropic API cost · pricing as of ${cost.pricingAsOf} · includes memory context read`}
    >
      {actualCost ? usdStr : `Est. ${usdStr}`}
      <span className="muted"> · {cost.modelLabel}</span>
    </span>
  );
}
