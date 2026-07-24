export type AuditWrite = {
  occurredAt: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "succeeded" | "denied" | "failed";
  beforeJson?: string | null;
  afterJson?: string | null;
  reason?: string | null;
};

export async function chainedAuditStatements(db: D1Database, input: AuditWrite) {
  const previous = await db.prepare(
    "SELECT entry_hash FROM riskshield_audit_chain ORDER BY sequence DESC LIMIT 1",
  ).first<{ entry_hash: string }>();
  const previousHash = previous?.entry_hash ?? "GENESIS";
  const auditId = crypto.randomUUID();
  const canonical = JSON.stringify([
    previousHash,
    auditId,
    input.occurredAt,
    input.actorId,
    input.action,
    input.resourceType,
    input.resourceId,
    input.result,
    input.beforeJson ?? null,
    input.afterJson ?? null,
    input.reason ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const entryHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    db.prepare(`INSERT INTO riskshield_audit_logs
      (id, occurred_at, actor_id, action, resource_type, resource_id, result, before_json, after_json, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        auditId,
        input.occurredAt,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.result,
        input.beforeJson ?? null,
        input.afterJson ?? null,
        input.reason ?? null,
      ),
    db.prepare(`INSERT INTO riskshield_audit_chain (audit_id, previous_hash, entry_hash, created_at)
      VALUES (?, ?, ?, ?)`)
      .bind(auditId, previousHash, entryHash, input.occurredAt),
  ];
}
