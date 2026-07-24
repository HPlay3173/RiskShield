export type CollectorEvidenceSource = {
  sourceId: string;
  provider: string;
  sourceLabel: string;
  url: string | null;
  publishedAt: string | null;
};

export function candidateSourcesFromEvidence(
  previousSources: Record<string, unknown>[],
  evidence: readonly CollectorEvidenceSource[],
  now: string,
) {
  return [...previousSources, ...evidence.map((item) => ({
    title: item.sourceLabel,
    url: item.url ?? "",
    date: item.publishedAt?.slice(0, 10) ?? now.slice(0, 10),
    sourceId: item.sourceId,
    provider: item.provider,
  }))]
    .filter((value, index, values) => values.findIndex((candidate) => candidate.url === value.url && candidate.title === value.title) === index)
    .slice(-8);
}
