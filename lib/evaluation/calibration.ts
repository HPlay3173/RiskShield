export type LabeledScore = { id: string; rawScore: number; expectedRisk: boolean };
export type CalibrationPoint = { rawScore: number; calibratedScore: number; sampleCount: number };

export type EvaluationMetrics = {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
  accuracy: number | null;
  brierScore: number | null;
  expectedCalibrationError: number | null;
};

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null;
}

export function measureScores(items: readonly LabeledScore[], threshold = 70): EvaluationMetrics {
  let truePositive = 0; let trueNegative = 0; let falsePositive = 0; let falseNegative = 0;
  let brier = 0;
  const bins = new Map<number, { count: number; probabilitySum: number; positive: number }>();
  for (const item of items) {
    const predicted = item.rawScore >= threshold;
    if (predicted && item.expectedRisk) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (item.expectedRisk) falseNegative += 1;
    else trueNegative += 1;
    const probability = item.rawScore / 100;
    brier += (probability - (item.expectedRisk ? 1 : 0)) ** 2;
    const bin = Math.min(9, Math.floor(item.rawScore / 10));
    const current = bins.get(bin) ?? { count: 0, probabilitySum: 0, positive: 0 };
    current.count += 1; current.probabilitySum += probability; current.positive += item.expectedRisk ? 1 : 0; bins.set(bin, current);
  }
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const ece = items.length ? [...bins.values()].reduce((sum, bin) => sum + (bin.count / items.length) * Math.abs(bin.probabilitySum / bin.count - bin.positive / bin.count), 0) : null;
  return {
    truePositive, trueNegative, falsePositive, falseNegative,
    precision, recall, f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
    falseNegativeRate: ratio(falseNegative, falseNegative + truePositive),
    accuracy: ratio(truePositive + trueNegative, items.length),
    brierScore: items.length ? brier / items.length : null,
    expectedCalibrationError: ece,
  };
}

export function fitIsotonicCalibration(items: readonly LabeledScore[]): CalibrationPoint[] {
  const grouped = new Map<number, { score: number; positives: number; count: number }>();
  for (const item of items) {
    const score = Math.max(0, Math.min(100, Math.round(item.rawScore)));
    const group = grouped.get(score) ?? { score, positives: 0, count: 0 };
    group.count += 1; group.positives += item.expectedRisk ? 1 : 0; grouped.set(score, group);
  }
  const blocks = [...grouped.values()].sort((left, right) => left.score - right.score).map((group) => ({ min: group.score, max: group.score, positives: group.positives, count: group.count }));
  for (let index = 0; index < blocks.length - 1;) {
    const left = blocks[index]; const right = blocks[index + 1];
    if (left.positives / left.count <= right.positives / right.count) { index += 1; continue; }
    blocks.splice(index, 2, { min: left.min, max: right.max, positives: left.positives + right.positives, count: left.count + right.count });
    index = Math.max(0, index - 1);
  }
  return blocks.flatMap((block) => [block.min, block.max].map((rawScore) => ({ rawScore, calibratedScore: Math.round((block.positives / block.count) * 100), sampleCount: block.count })))
    .filter((point, index, all) => index === 0 || point.rawScore !== all[index - 1].rawScore);
}

export function applyCalibration(rawScore: number, mapping: readonly CalibrationPoint[]) {
  if (!mapping.length) return rawScore;
  const sorted = [...mapping].sort((left, right) => left.rawScore - right.rawScore);
  if (rawScore <= sorted[0].rawScore) return sorted[0].calibratedScore;
  if (rawScore >= sorted.at(-1)!.rawScore) return sorted.at(-1)!.calibratedScore;
  const upperIndex = sorted.findIndex((point) => point.rawScore >= rawScore);
  const lower = sorted[upperIndex - 1]; const upper = sorted[upperIndex];
  if (upper.rawScore === lower.rawScore) return upper.calibratedScore;
  const progress = (rawScore - lower.rawScore) / (upper.rawScore - lower.rawScore);
  return Math.round(lower.calibratedScore + (upper.calibratedScore - lower.calibratedScore) * progress);
}
