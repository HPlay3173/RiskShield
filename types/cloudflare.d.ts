interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{
    results?: T[];
    success: boolean;
    meta: { changes?: number };
  }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
}

interface R2Object {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
}

interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2Object>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    DATASETS?: R2Bucket;
    GOOGLE_OIDC_CLIENT_ID?: string;
    GOOGLE_OIDC_CLIENT_SECRET?: string;
    RISKSHIELD_ACCESS_CODE?: string;
    RISKSHIELD_SESSION_SIGNING_KEY?: string;
    RISKSHIELD_CANONICAL_ORIGIN?: string;
    RISKSHIELD_MANAGER_EMAILS?: string;
    [binding: string]: unknown;
  };
}
