import { prepareInterpreterInput } from "../v0-4/interpreter";

export type CollectorProvider = "x" | "threads" | "dcinside";

export type CollectorEnvironment = {
  DB: D1Database;
  RISKSHIELD_X_BEARER_TOKEN?: string;
  RISKSHIELD_THREADS_ACCESS_TOKEN?: string;
};

export type CollectorSource = {
  id: string;
  provider: CollectorProvider;
  label: string;
  query: string;
  endpoint: string | null;
  enabled: boolean;
  intervalMinutes: number;
  cursor: string | null;
  lastRunAt: string | null;
};

type CollectedPost = {
  externalId: string;
  text: string;
  url: string | null;
  publishedAt: string | null;
};

function htmlText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;|&#34;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

async function digestId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.normalize("NFKC")));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function xPosts(source: CollectorSource, env: CollectorEnvironment): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  if (!env.RISKSHIELD_X_BEARER_TOKEN) throw new Error("X Bearer token이 설정되지 않았습니다.");
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", source.query);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("tweet.fields", "created_at,lang");
  if (source.cursor) url.searchParams.set("since_id", source.cursor);
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.RISKSHIELD_X_BEARER_TOKEN}` } });
  if (!response.ok) throw new Error(`X API ${response.status}`);
  const payload = await response.json() as { data?: Array<{ id: string; text: string; created_at?: string }>; meta?: { newest_id?: string } };
  return {
    posts: (payload.data ?? []).map((item) => ({ externalId: item.id, text: item.text, url: `https://x.com/i/web/status/${item.id}`, publishedAt: item.created_at ?? null })),
    cursor: payload.meta?.newest_id ?? source.cursor,
  };
}

async function threadsPosts(source: CollectorSource, env: CollectorEnvironment): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  if (!env.RISKSHIELD_THREADS_ACCESS_TOKEN) throw new Error("Threads access token이 설정되지 않았습니다.");
  const url = new URL("https://graph.threads.net/keyword_search");
  url.searchParams.set("q", source.query);
  url.searchParams.set("search_type", "RECENT");
  url.searchParams.set("fields", "id,text,timestamp,permalink");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", env.RISKSHIELD_THREADS_ACCESS_TOKEN);
  if (source.cursor) url.searchParams.set("since", source.cursor);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Threads API ${response.status}`);
  const payload = await response.json() as { data?: Array<{ id: string; text?: string; timestamp?: string; permalink?: string }> };
  const posts = (payload.data ?? []).flatMap((item) => item.text ? [{ externalId: item.id, text: item.text, url: item.permalink ?? null, publishedAt: item.timestamp ?? null }] : []);
  const newest = posts.map((post) => post.publishedAt).filter(Boolean).sort().at(-1) ?? source.cursor;
  return { posts, cursor: newest };
}

function dcEndpoint(source: CollectorSource) {
  if (!source.endpoint) throw new Error("디시인사이드 공개 피드 또는 검색 주소가 필요합니다.");
  const value = source.endpoint.includes("{query}")
    ? source.endpoint.replace("{query}", encodeURIComponent(source.query))
    : source.endpoint;
  const url = new URL(value);
  if (!/(^|\.)dcinside\.com$/iu.test(url.hostname)) throw new Error("디시인사이드 도메인의 공개 주소만 사용할 수 있습니다.");
  return url;
}

async function dcPosts(source: CollectorSource): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  const url = dcEndpoint(source);
  const response = await fetch(url, { headers: { "user-agent": "RiskShieldSchoolResearch/0.5 (+human-reviewed; low-frequency)" } });
  if (!response.ok) throw new Error(`DCInside public page ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const posts: CollectedPost[] = [];
  if (contentType.includes("json")) {
    const payload = JSON.parse(body) as unknown;
    const items = Array.isArray(payload) ? payload : typeof payload === "object" && payload && "data" in payload && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text : typeof record.title === "string" ? record.title : "";
      if (!text) continue;
      posts.push({ externalId: String(record.id ?? await digestId(text)), text, url: typeof record.url === "string" ? record.url : null, publishedAt: typeof record.created_at === "string" ? record.created_at : null });
    }
  } else {
    const entryPattern = /<(?:item|article)\b[^>]*>([\s\S]*?)<\/(?:item|article)>/giu;
    const blocks = [...body.matchAll(entryPattern)].map((match) => match[1]);
    const candidates = blocks.length ? blocks : [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)].map((match) => `<link>${match[1]}</link><title>${match[2]}</title>`);
    for (const block of candidates.slice(0, 100)) {
      const title = htmlText(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? block);
      const description = htmlText(block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/iu)?.[1] ?? "");
      const text = [title, description].filter(Boolean).join(" — ").slice(0, 2_000);
      if (!text || !text.includes(source.query)) continue;
      const link = htmlText(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/iu)?.[1] ?? "") || null;
      posts.push({ externalId: await digestId(link ?? text), text, url: link, publishedAt: null });
    }
  }
  return { posts, cursor: source.cursor };
}

async function fetchPosts(source: CollectorSource, env: CollectorEnvironment) {
  if (source.provider === "x") return xPosts(source, env);
  if (source.provider === "threads") return threadsPosts(source, env);
  return dcPosts(source);
}

function sourceFromRow(row: Record<string, unknown>): CollectorSource {
  return {
    id: String(row.id), provider: row.provider as CollectorProvider, label: String(row.label), query: String(row.query),
    endpoint: typeof row.endpoint === "string" ? row.endpoint : null, enabled: Boolean(row.enabled),
    intervalMinutes: Number(row.interval_minutes), cursor: typeof row.cursor === "string" ? row.cursor : null,
    lastRunAt: typeof row.last_run_at === "string" ? row.last_run_at : null,
  };
}

export async function runCollectorSource(source: CollectorSource, env: CollectorEnvironment) {
  const startedAt = new Date().toISOString();
  const runId = `collector_run_${crypto.randomUUID()}`;
  let fetchedCount = 0;
  let newCount = 0;
  let candidateCount = 0;
  try {
    const fetched = await fetchPosts(source, env);
    fetchedCount = fetched.posts.length;
    for (const post of fetched.posts) {
      const prepared = prepareInterpreterInput(post.text, 2_000);
      if (prepared.masked || !post.text.trim()) continue;
      const postHash = await digestId(`${source.id}:${post.externalId}`);
      const candidateHash = await digestId(post.text);
      const postId = `collected_${postHash.slice(0, 32)}`;
      const candidateId = `collector_candidate_${candidateHash.slice(0, 32)}`;
      const inserted = await env.DB.prepare(`
        INSERT INTO riskshield_collected_posts
          (id, source_id, provider, external_id, text, source_url, published_at, collected_at, candidate_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, external_id) DO NOTHING
      `).bind(postId, source.id, source.provider, post.externalId, post.text, post.url, post.publishedAt, startedAt, candidateId).run();
      if (!inserted.meta.changes) continue;
      newCount += 1;
      const payload = {
        id: candidateId, expression: post.text, riskFamily: "general_substantiation", riskDomain: "자동 수집 미분류",
        reportType: "collector_discovery", status: "pending", noveltyScore: null, confidence: null, sourceCount: 1,
        createdAt: startedAt, expressionGroup: [post.text], contextSummary: `${source.label} 자동 수집 결과입니다. 사람 검토로 의미와 위험 범주를 확정하세요.`,
        evidence: [post.text], positiveTests: [post.text], negativeTests: [`“${post.text.slice(0, 160)}”라는 표현은 사용하지 마세요.`],
        redTeam: null, modelConflict: null, policyChange: null, draft: null, lineage: null,
        sources: [{ title: source.label, url: post.url ?? "", date: post.publishedAt?.slice(0, 10) ?? startedAt.slice(0, 10) }],
        autoInclusionBlockedReason: "자동 수집 데이터는 사람 검토와 테스트를 통과하기 전까지 활성 규칙에 반영되지 않습니다.",
      };
      await env.DB.prepare(`
        INSERT INTO riskshield_candidates (id, status, payload, created_at, updated_at)
        VALUES (?, 'pending', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `).bind(candidateId, JSON.stringify(payload), startedAt, startedAt).run();
      candidateCount += 1;
    }
    const finishedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO riskshield_collector_runs (id, source_id, status, fetched_count, new_count, candidate_count, message, started_at, finished_at) VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)`)
        .bind(runId, source.id, fetchedCount, newCount, candidateCount, "수집된 글은 검토 대기 후보로만 저장했습니다.", startedAt, finishedAt),
      env.DB.prepare(`UPDATE riskshield_collector_sources SET cursor = ?, last_run_at = ?, last_status = 'succeeded', last_message = ?, updated_at = ? WHERE id = ?`)
        .bind(fetched.cursor, finishedAt, `${newCount}개 신규 · ${candidateCount}개 후보`, finishedAt, source.id),
    ]);
    return { runId, status: "succeeded" as const, fetchedCount, newCount, candidateCount, message: "수집을 완료했습니다." };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "수집 중 알 수 없는 오류가 발생했습니다.";
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO riskshield_collector_runs (id, source_id, status, fetched_count, new_count, candidate_count, message, started_at, finished_at) VALUES (?, ?, 'failed', ?, ?, ?, ?, ?, ?)`)
        .bind(runId, source.id, fetchedCount, newCount, candidateCount, message, startedAt, finishedAt),
      env.DB.prepare(`UPDATE riskshield_collector_sources SET last_run_at = ?, last_status = 'failed', last_message = ?, updated_at = ? WHERE id = ?`)
        .bind(finishedAt, message, finishedAt, source.id),
    ]);
    return { runId, status: "failed" as const, fetchedCount, newCount, candidateCount, message };
  }
}

export async function runDueCollectors(env: CollectorEnvironment) {
  const rows = await env.DB.prepare(`
    SELECT id, provider, label, query, endpoint, enabled, interval_minutes, cursor, last_run_at
    FROM riskshield_collector_sources
    WHERE enabled = 1 AND (last_run_at IS NULL OR datetime(last_run_at, '+' || interval_minutes || ' minutes') <= datetime('now'))
    ORDER BY COALESCE(last_run_at, '') ASC LIMIT 12
  `).all<Record<string, unknown>>();
  const results = [];
  for (const row of rows.results ?? []) results.push(await runCollectorSource(sourceFromRow(row), env));
  return results;
}

export async function readCollectorSource(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT id, provider, label, query, endpoint, enabled, interval_minutes, cursor, last_run_at FROM riskshield_collector_sources WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  return row ? sourceFromRow(row) : null;
}
