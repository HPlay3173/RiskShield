export const ROLES = ["reviewer", "developer", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "candidate:read",
  "candidate:decide",
  "skill:read_admin",
  "skill:propose_revision",
  "dataset:manage",
  "training:run",
  "evaluation:run",
  "model:manage",
  "prompt:manage",
  "release:deploy",
  "release:rollback",
  "audit:read_admin",
  "audit:read_dev",
  "principal:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type CurrentPrincipal = {
  userId: string;
  externalSubject: string;
  normalizedEmail: string;
  identityIssuer: "https://accounts.google.com" | "riskshield:local-development";
  authSource: "google_oidc" | "development_fixture";
  role: Role;
  roleVersion: number;
  capabilities: ReadonlySet<Capability>;
  sessionId: string;
  csrfToken: string;
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
