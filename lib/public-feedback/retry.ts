export type PublicFeedbackRetryResult = { processed: number; promoted: number; monitored: number; rejected: number; errors: number };

export async function retryPublicFeedbackRows<T>(
  rows: readonly T[],
  process: (row: T) => Promise<"promoted" | "monitor" | "rejected">,
): Promise<PublicFeedbackRetryResult> {
  const result: PublicFeedbackRetryResult = { processed: 0, promoted: 0, monitored: 0, rejected: 0, errors: 0 };
  for (const row of rows.slice(0, 3)) {
    result.processed += 1;
    try {
      const status = await process(row);
      if (status === "promoted") result.promoted += 1;
      else if (status === "monitor") result.monitored += 1;
      else result.rejected += 1;
    } catch { result.errors += 1; }
  }
  return result;
}
