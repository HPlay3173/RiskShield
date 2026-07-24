export function summarizeAiCoverage(selectedClaimCount: number, analyzedClaimCount: number) {
  const selected = Math.max(0, Math.floor(selectedClaimCount));
  const analyzed = Math.max(0, Math.min(selected, Math.floor(analyzedClaimCount)));
  return {
    selectedClaimCount: selected,
    analyzedClaimCount: analyzed,
    state: analyzed === 0 ? "fallback" as const
      : analyzed < selected ? "partial" as const
        : "ready" as const,
  };
}
