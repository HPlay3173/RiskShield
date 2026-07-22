import { prepareInterpreterInput } from "../v0-4/interpreter";
import { GoogleTrainingDraftProvider } from "../training/google-draft-provider";
import type { TrainingDraft } from "../training/mvp";
import { GoogleCollectorQualificationProvider, type QualificationAssessment } from "./google-qualification-provider";
import { buildXRecentQuery, isHardRejectedExpression, newestNumericId, normalizeCollectedExpression, parseApprovedFeedEntries, qualificationGate, type ObservationContextLabel } from "./quality";
import { parseYouTubeVideoInput } from "./youtube";

export type CollectorProvider = "youtube" | "bluesky" | "mastodon" | "x" | "threads" | "dcinside";

export type CollectorEnvironment = {
  DB: D1Database;
  RISKSHIELD_X_BEARER_TOKEN?: string;
  RISKSHIELD_THREADS_ACCESS_TOKEN?: string;
  RISKSHIELD_INTERPRETER_API_KEY?: string;
  RISKSHIELD_YOUTUBE_API_KEY?: string;
  RISKSHIELD_COLLECTOR_HASH_KEY?: string;
  RISKSHIELD_SESSION_SIGNING_KEY?: string;
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
  authorOpaqueId: string | null;
};

type StoredPost = CollectedPost & {
  postId: string;
  excerpt: string;
  authorHash: string | null;
};

export type ExpressionGroup = {
  expression: string;
  normalized: string;
  postIds: Set<string>;
  authorHashes: Set<string>;
  sourceIds: Set<string>;
  evidence: Array<{ id: string; excerpt: string; url: string | null; publishedAt: string | null; label: ObservationContextLabel }>;
  score: number;
};

const MAX_POSTS_PER_RUN = 100;
const MAX_CANDIDATES_PER_RUN = 12;
const MAX_STORED_EXCERPT_CHARS = 420;
const COMMON_TOKENS = new Set([
  "그리고", "그러나", "하지만", "그래서", "또한", "대한", "있는", "없는", "있다", "없다", "합니다", "입니다",
  "했다", "한다", "하는", "되는", "같은", "정말", "너무", "오늘", "이번", "이런", "저런", "그런", "우리", "여러분",
  "사람", "생각", "문제", "내용", "댓글", "게시물", "커뮤니티", "표현", "단어", "의미", "사용", "혐오", "비하", "욕설", "은어",
  "링크", "사용자", "the", "and", "for", "with", "this", "that", "from", "http", "https",
]);

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

const normalizedExpression = normalizeCollectedExpression;

function queryTerms(query: string) {
  return new Set((query.match(/[\p{L}\p{N}ㄱ-ㅎㅏ-ㅣ]{2,24}/gu) ?? []).map(normalizedExpression));
}

function hasKoreanContent(text: string) {
  const letters = text.match(/[\p{L}ㄱ-ㅎㅏ-ㅣ]/gu) ?? [];
  const korean = text.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/gu) ?? [];
  return korean.length >= 2 && korean.length / Math.max(letters.length, 1) >= 0.15;
}

function boundedExcerpt(text: string, expression?: string) {
  const compact = text.replace(/https?:\/\/\S+/giu, "[링크]").replace(/@[\p{L}\p{N}_.-]+/gu, "@사용자").replace(/\s+/gu, " ").trim();
  if (compact.length <= MAX_STORED_EXCERPT_CHARS) return compact;
  const index = expression ? compact.toLocaleLowerCase("ko-KR").indexOf(expression.toLocaleLowerCase("ko-KR")) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - 160);
  return `${start > 0 ? "…" : ""}${compact.slice(start, start + MAX_STORED_EXCERPT_CHARS)}${start + MAX_STORED_EXCERPT_CHARS < compact.length ? "…" : ""}`;
}

function isPublicHttpsEndpoint(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (url.protocol !== "https:" || !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")) return null;
  url.username = "";
  url.password = "";
  return url;
}

async function digestId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.normalize("NFKC")));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function candidateIdForExpression(expression: string) {
  const candidateHash = await digestId(normalizedExpression(expression));
  return `collector_candidate_${candidateHash.slice(0, 32)}`;
}

async function authorHashFor(post: CollectedPost, source: CollectorSource, env: CollectorEnvironment) {
  if (!post.authorOpaqueId) return null;
  const secret = env.RISKSHIELD_COLLECTOR_HASH_KEY?.trim() || env.RISKSHIELD_SESSION_SIGNING_KEY?.trim();
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${source.provider}:${post.authorOpaqueId}`));
  return Array.from(new Uint8Array(signature), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function blueskyPosts(source: CollectorSource): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts");
  url.searchParams.set("q", source.query);
  url.searchParams.set("sort", "latest");
  url.searchParams.set("lang", "ko");
  url.searchParams.set("limit", String(MAX_POSTS_PER_RUN));
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "RiskShieldSchoolResearch/0.5" } });
  if (!response.ok) throw new Error(`Bluesky public search ${response.status}`);
  const payload = await response.json() as {
    cursor?: string;
    posts?: Array<{ uri?: string; author?: { did?: string; handle?: string }; record?: { text?: string; createdAt?: string } }>;
  };
  const posts = (payload.posts ?? []).flatMap((item) => {
    const text = item.record?.text?.trim();
    const uri = item.uri ?? "";
    if (!text || !uri) return [];
    const rkey = uri.split("/").at(-1) ?? "";
    const profile = item.author?.handle ?? uri.split("/")[2] ?? "";
    if (source.lastRunAt && item.record?.createdAt && Date.parse(item.record.createdAt) <= Date.parse(source.lastRunAt)) return [];
    return [{ externalId: uri, text, url: profile && rkey ? `https://bsky.app/profile/${encodeURIComponent(profile)}/post/${encodeURIComponent(rkey)}` : null, publishedAt: item.record?.createdAt ?? null, authorOpaqueId: item.author?.did ?? item.author?.handle ?? null }];
  });
  return { posts, cursor: null };
}

async function mastodonPosts(source: CollectorSource): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  if (!source.endpoint) throw new Error("Mastodon 공개 인스턴스 주소가 필요합니다.");
  const base = isPublicHttpsEndpoint(source.endpoint);
  if (!base) throw new Error("공개 HTTPS Mastodon 인스턴스 주소만 사용할 수 있습니다.");
  const hashtag = source.query.replace(/^#/u, "").trim();
  if (!/^[\p{L}\p{N}_-]{2,80}$/u.test(hashtag)) throw new Error("Mastodon 검색어에는 해시태그 하나만 입력해 주세요.");
  const url = new URL(`/api/v1/timelines/tag/${encodeURIComponent(hashtag)}`, base.origin);
  url.searchParams.set("limit", "40");
  if (source.cursor) url.searchParams.set("since_id", source.cursor);
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "RiskShieldSchoolResearch/0.5 (+human-reviewed)" } });
  if (!response.ok) throw new Error(`Mastodon public hashtag timeline ${response.status}`);
  const payload = await response.json() as Array<{ id?: string; content?: string; url?: string; created_at?: string; visibility?: string; account?: { id?: string } }>;
  const posts = payload.flatMap((item) => item.id && item.content && item.visibility !== "private" && item.visibility !== "direct"
    ? [{ externalId: item.id, text: htmlText(item.content), url: item.url ?? null, publishedAt: item.created_at ?? null, authorOpaqueId: item.account?.id ?? null }]
    : []);
  const cursor = newestNumericId(posts.map((post) => post.externalId), source.cursor);
  return { posts, cursor };
}

async function xPosts(source: CollectorSource, env: CollectorEnvironment): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  if (!env.RISKSHIELD_X_BEARER_TOKEN) throw new Error("X Bearer token이 설정되지 않았습니다.");
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", buildXRecentQuery(source.query));
  url.searchParams.set("max_results", "100");
  url.searchParams.set("tweet.fields", "created_at,lang,author_id");
  if (source.cursor) url.searchParams.set("since_id", source.cursor);
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.RISKSHIELD_X_BEARER_TOKEN}` } });
  if (!response.ok) throw new Error(`X API ${response.status}`);
  const payload = await response.json() as { data?: Array<{ id: string; text: string; created_at?: string; author_id?: string }>; meta?: { newest_id?: string } };
  return {
    posts: (payload.data ?? []).map((item) => ({ externalId: item.id, text: item.text, url: `https://x.com/i/web/status/${item.id}`, publishedAt: item.created_at ?? null, authorOpaqueId: item.author_id ?? null })),
    cursor: payload.meta?.newest_id ?? source.cursor,
  };
}

async function threadsPosts(source: CollectorSource, env: CollectorEnvironment): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  if (!env.RISKSHIELD_THREADS_ACCESS_TOKEN) throw new Error("Threads access token이 설정되지 않았습니다.");
  const url = new URL("https://graph.threads.net/keyword_search");
  url.searchParams.set("q", source.query);
  url.searchParams.set("search_type", "RECENT");
  url.searchParams.set("fields", "id,text,timestamp,permalink,username");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", env.RISKSHIELD_THREADS_ACCESS_TOKEN);
  if (source.cursor) url.searchParams.set("since", source.cursor);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Threads API ${response.status}`);
  const payload = await response.json() as { data?: Array<{ id: string; text?: string; timestamp?: string; permalink?: string; username?: string }> };
  const posts = (payload.data ?? []).flatMap((item) => item.text ? [{ externalId: item.id, text: item.text, url: item.permalink ?? null, publishedAt: item.timestamp ?? null, authorOpaqueId: item.username ?? null }] : []);
  const newest = posts.map((post) => post.publishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? source.cursor;
  return { posts, cursor: newest };
}

function dcEndpoint(source: CollectorSource) {
  if (!source.endpoint) throw new Error("디시인사이드 공개 피드 또는 검색 주소가 필요합니다.");
  const value = source.endpoint.includes("{query}") ? source.endpoint.replace("{query}", encodeURIComponent(source.query)) : source.endpoint;
  const url = new URL(value);
  if (!/(^|\.)dcinside\.com$/iu.test(url.hostname) || url.protocol !== "https:") throw new Error("디시인사이드의 공개 HTTPS 주소만 사용할 수 있습니다.");
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
      posts.push({ externalId: String(record.id ?? await digestId(text)), text, url: typeof record.url === "string" ? record.url : null, publishedAt: typeof record.created_at === "string" ? record.created_at : null, authorOpaqueId: typeof record.author_id === "string" ? record.author_id : null });
    }
  } else {
    const candidates = parseApprovedFeedEntries(body);
    if (!candidates.length) throw new Error("DCInside 응답이 승인된 JSON·RSS·article 형식이 아닙니다.");
    for (const candidate of candidates.slice(0, MAX_POSTS_PER_RUN)) {
      const text = candidate.text.slice(0, 2_000);
      posts.push({ externalId: await digestId(candidate.link ?? text), text, url: candidate.link, publishedAt: null, authorOpaqueId: null });
    }
  }
  return { posts, cursor: source.cursor };
}

async function youtubePosts(source: CollectorSource, env: CollectorEnvironment): Promise<{ posts: CollectedPost[]; cursor: string | null }> {
  const apiKey = env.RISKSHIELD_YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YouTube Data API 전용 키가 설정되지 않았습니다. Sites에 RISKSHIELD_YOUTUBE_API_KEY를 비밀 값으로 추가해 주세요.");
  const videoIds = parseYouTubeVideoInput(source.query).ids;
  if (!videoIds.length) throw new Error("YouTube 수집에는 공개 동영상 ID가 하나 이상 필요합니다.");
  const posts: CollectedPost[] = [];
  for (const videoId of videoIds) {
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet"); url.searchParams.set("videoId", videoId); url.searchParams.set("maxResults", "100");
    url.searchParams.set("order", "time"); url.searchParams.set("textFormat", "plainText"); url.searchParams.set("key", apiKey);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      let reason = "";
      try {
        const errorPayload = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
        reason = errorPayload.error?.errors?.[0]?.reason ?? "";
      } catch {
        // Google may return an empty or non-JSON body. Status-based guidance still applies.
      }
      if (response.status === 401) throw new Error("YouTube Data API 키 인증에 실패했습니다. 전용 키가 유효한지 확인해 주세요.");
      if (response.status === 403 && reason === "commentsDisabled") throw new Error("이 YouTube 영상은 댓글이 비활성화되어 있습니다.");
      if (response.status === 403 && (reason === "quotaExceeded" || reason === "dailyLimitExceeded")) throw new Error("YouTube Data API의 오늘 할당량을 모두 사용했습니다.");
      if (response.status === 403 && (reason === "accessNotConfigured" || reason === "forbidden")) throw new Error("해당 Google Cloud 프로젝트에서 YouTube Data API v3가 활성화되어 있는지와 API 제한을 확인해 주세요.");
      throw new Error(`YouTube 댓글을 가져오지 못했습니다. HTTP ${response.status}`);
    }
    const payload = await response.json() as { items?: Array<{ id?: string; snippet?: { topLevelComment?: { id?: string; snippet?: { textDisplay?: string; publishedAt?: string; authorChannelId?: { value?: string } } } } }> };
    for (const item of payload.items ?? []) {
      const comment = item.snippet?.topLevelComment;
      const text = comment?.snippet?.textDisplay?.trim();
      const id = comment?.id ?? item.id;
      if (!id || !text) continue;
      posts.push({ externalId: id, text, url: `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(id)}`, publishedAt: comment?.snippet?.publishedAt ?? null, authorOpaqueId: comment?.snippet?.authorChannelId?.value ?? null });
    }
  }
  return { posts: posts.slice(0, MAX_POSTS_PER_RUN), cursor: null };
}

async function fetchPosts(source: CollectorSource, env: CollectorEnvironment) {
  if (source.provider === "youtube") return youtubePosts(source, env);
  if (source.provider === "bluesky") return blueskyPosts(source);
  if (source.provider === "mastodon") return mastodonPosts(source);
  if (source.provider === "x") return xPosts(source, env);
  if (source.provider === "threads") return threadsPosts(source, env);
  return dcPosts(source);
}

function candidateTokens(text: string, excluded: Set<string>) {
  const cleaned = text.normalize("NFKC").replace(/https?:\/\/\S+|@[\p{L}\p{N}_.-]+/giu, " ");
  const tokens = cleaned.match(/[\p{L}\p{N}ㄱ-ㅎㅏ-ㅣ]{2,24}/gu) ?? [];
  const values: Array<{ display: string; normalized: string; weirdness: number }> = [];
  for (const token of tokens) {
    const normalized = normalizedExpression(token);
    if (!normalized || !/[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(token) || excluded.has(normalized) || COMMON_TOKENS.has(normalized) || isHardRejectedExpression(normalized)) continue;
    const hasJamo = /[ㄱ-ㅎㅏ-ㅣ]/u.test(token);
    const isMixed = /[가-힣]/u.test(token) && /[A-Za-z0-9]/u.test(token);
    const repeated = /(.)\1{2,}/u.test(token);
    const compact = normalized.length >= 2 && normalized.length <= 8;
    values.push({ display: token.slice(0, 24), normalized, weirdness: Number(hasJamo) * 3 + Number(isMixed) * 3 + Number(repeated) * 2 + Number(compact) });
  }
  return values;
}

async function knownExpressions(db: D1Database) {
  const known = new Set<string>();
  const skills = await db.prepare("SELECT payload FROM risk_skills WHERE review_status = 'reviewed' LIMIT 500").all<Record<string, unknown>>();
  for (const row of skills.results ?? []) {
    if (typeof row.payload !== "string") continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const values = [payload.expression, ...(Array.isArray(payload.expressionGroup) ? payload.expressionGroup : []), ...(Array.isArray(payload.triggerPatterns) ? payload.triggerPatterns : [])];
      for (const value of values) if (typeof value === "string") known.add(normalizedExpression(value));
    } catch { /* malformed historical rows are ignored and remain reviewable */ }
  }
  return known;
}

async function saveObservations(posts: StoredPost[], source: CollectorSource, excluded: Set<string>, env: CollectorEnvironment, now: string) {
  let count = 0;
  for (const post of posts) {
    const unique = new Map(candidateTokens(post.excerpt, excluded).map((candidate) => [candidate.normalized, candidate]));
    for (const candidate of unique.values()) {
      const observationHash = await digestId(`${post.postId}:${candidate.normalized}`);
      const inserted = await env.DB.prepare(`
        INSERT INTO riskshield_expression_observations
          (id, normalized_expression, display_expression, source_id, provider, post_id, author_hash, redacted_excerpt,
           source_url, published_at, context_label, classifier_confidence, risk_family, qualification_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uncertain', NULL, NULL, 'observed', ?, ?)
        ON CONFLICT(source_id, post_id, normalized_expression) DO NOTHING
      `).bind(`observation_${observationHash.slice(0, 32)}`, candidate.normalized, candidate.display, source.id, source.provider,
        post.postId, post.authorHash, boundedExcerpt(post.excerpt, candidate.display), post.url, post.publishedAt, now, now).run();
      count += Number(inserted.meta.changes ?? 0);
    }
  }
  return count;
}

async function recentExpressionGroups(env: CollectorEnvironment) {
  const rows = await env.DB.prepare(`
    SELECT id, normalized_expression, display_expression, source_id, post_id, author_hash, redacted_excerpt, source_url,
           published_at, context_label
    FROM riskshield_expression_observations
    WHERE datetime(created_at) >= datetime('now', '-14 days')
      AND qualification_status IN ('observed', 'monitor')
    ORDER BY created_at DESC LIMIT 4000
  `).all<Record<string, unknown>>();
  const groups = new Map<string, ExpressionGroup>();
  for (const row of rows.results ?? []) {
    const normalized = String(row.normalized_expression);
    const current = groups.get(normalized) ?? { expression: String(row.display_expression), normalized, postIds: new Set<string>(), authorHashes: new Set<string>(), sourceIds: new Set<string>(), evidence: [], score: 0 };
    current.postIds.add(String(row.post_id)); current.sourceIds.add(String(row.source_id));
    if (typeof row.author_hash === "string" && row.author_hash) current.authorHashes.add(row.author_hash);
    if (current.evidence.length < 6) current.evidence.push({ id: String(row.id), excerpt: String(row.redacted_excerpt), url: typeof row.source_url === "string" ? row.source_url : null, publishedAt: typeof row.published_at === "string" ? row.published_at : null, label: String(row.context_label) as ObservationContextLabel });
    current.score = current.postIds.size * 10 + current.authorHashes.size * 8 + current.sourceIds.size * 6;
    groups.set(normalized, current);
  }
  return [...groups.values()]
    .filter((group) => (group.postIds.size >= 3 || group.sourceIds.size >= 2) && group.authorHashes.size >= 2)
    .sort((left, right) => right.score - left.score || left.expression.localeCompare(right.expression, "ko"))
    .slice(0, MAX_CANDIDATES_PER_RUN);
}

async function qualifyExpressionGroups(groups: ExpressionGroup[], env: CollectorEnvironment) {
  const provider = new GoogleCollectorQualificationProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
  if (!provider.configured || !groups.length) return { assessments: new Map<string, QualificationAssessment>(), state: "not_configured" as const };
  try {
    const results = await provider.qualify(groups.map((group) => ({ expression: group.expression, normalized: group.normalized, evidence: group.evidence.map(({ id, excerpt }) => ({ id, excerpt })) })), AbortSignal.timeout(20_000));
    return { assessments: new Map(results.map((item) => [item.normalized, item])), state: "ready" as const };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "qualification_provider_unavailable";
    return { assessments: new Map<string, QualificationAssessment>(), state: code };
  }
}

async function persistAssessment(group: ExpressionGroup, assessment: QualificationAssessment | null, env: CollectorEnvironment, now: string) {
  const labels = new Map(assessment?.evidenceLabels.map((item) => [item.id, item.label]) ?? []);
  const status = assessment?.disposition === "reject" ? "rejected" : "monitor";
  for (const evidence of group.evidence) {
    const label = labels.get(evidence.id) ?? "uncertain";
    await env.DB.prepare(`UPDATE riskshield_expression_observations
      SET context_label = ?, classifier_confidence = ?, risk_family = ?, qualification_status = ?, updated_at = ? WHERE id = ?`)
      .bind(label, assessment?.confidence ?? null, assessment?.riskFamily ?? null, status, now, evidence.id).run();
    evidence.label = label;
  }
  await env.DB.prepare(`UPDATE riskshield_expression_observations
    SET qualification_status = ?, classifier_confidence = ?, risk_family = ?, updated_at = ?
    WHERE normalized_expression = ? AND datetime(created_at) >= datetime('now', '-14 days') AND qualification_status IN ('observed', 'monitor')`)
    .bind(status, assessment?.confidence ?? null, assessment?.riskFamily ?? null, now, group.normalized).run();
}

function passesQualification(group: ExpressionGroup, assessment: QualificationAssessment) {
  const direct = group.evidence.filter((item) => ["direct_attack", "group_discrimination", "threat", "coded_reference"].includes(item.label)).length;
  const contextual = group.evidence.filter((item) => ["quotation", "warning", "definition", "benign"].includes(item.label)).length;
  return qualificationGate({ observationCount: group.postIds.size, distinctAuthorCount: group.authorHashes.size, distinctSourceCount: group.sourceIds.size, directEvidenceCount: direct, contextualEvidenceCount: contextual, confidence: assessment.confidence, disposition: assessment.disposition });
}

async function draftExpressionGroups(groups: ExpressionGroup[], source: CollectorSource, env: CollectorEnvironment, runId: string) {
  const provider = new GoogleTrainingDraftProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
  const drafts = new Map<string, TrainingDraft>();
  if (!provider.configured || !groups.length) return { drafts, state: "not_configured" as const };
  const candidates = await Promise.all(groups.map(async (group) => ({
    candidateId: await candidateIdForExpression(group.normalized),
    representativeExpression: group.expression,
    category: "community_expression_unclassified",
    nearestReviewedSkill: null,
    positiveTest: group.evidence.find((item) => ["direct_attack", "group_discrimination", "threat", "coded_reference"].includes(item.label))?.excerpt ?? group.expression,
    negativeTest: `“${group.expression}”이라는 표현은 사용하지 마세요.`,
  })));
  try {
    const result = await provider.generateBatch({
      runId,
      datasetVersionId: `collector:${source.id}`,
      batchId: `${runId}:expressions`,
      candidates,
    }, AbortSignal.timeout(15_000));
    for (const draft of result.drafts) drafts.set(draft.candidateId, draft);
    return { drafts, state: "ready" as const };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "provider_unavailable";
    return { drafts, state: code };
  }
}

async function saveCandidate(group: ExpressionGroup, source: CollectorSource, env: CollectorEnvironment, now: string, draft: TrainingDraft | null, assessment: QualificationAssessment) {
  const candidateId = await candidateIdForExpression(group.normalized);
  const existing = await env.DB.prepare("SELECT payload FROM riskshield_candidates WHERE id = ? LIMIT 1").bind(candidateId).first<Record<string, unknown>>();
  let previous: Record<string, unknown> = {};
  if (typeof existing?.payload === "string") {
    try { previous = JSON.parse(existing.payload) as Record<string, unknown>; } catch { previous = {}; }
  }
  const previousEvidence = Array.isArray(previous.evidence) ? previous.evidence.filter((value): value is string => typeof value === "string") : [];
  const previousSources = Array.isArray(previous.sources) ? previous.sources.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
  const evidence = [...new Set([...previousEvidence, ...group.evidence.map((item) => item.excerpt)])].slice(-8);
  const sources = [...previousSources, ...group.evidence.map((item) => ({ title: source.label, url: item.url ?? "", date: item.publishedAt?.slice(0, 10) ?? now.slice(0, 10) }))]
    .filter((value, index, values) => values.findIndex((candidate) => candidate.url === value.url && candidate.title === value.title) === index)
    .slice(-8);
  const sourceCount = Math.min(10_000, Number(previous.sourceCount ?? 0) + group.postIds.size);
  const payload = {
    ...previous,
    id: candidateId,
    expression: group.expression,
    riskFamily: assessment.riskFamily,
    riskDomain: previous.riskDomain ?? "자동 수집 · AI 적격성 통과",
    reportType: "collector_discovery",
    status: "pending",
    noveltyScore: null,
    confidence: assessment.confidence,
    sourceCount,
    createdAt: previous.createdAt ?? now,
    updatedAt: now,
    expressionGroup: [...new Set([...(Array.isArray(previous.expressionGroup) ? previous.expressionGroup.filter((value): value is string => typeof value === "string") : []), group.expression])].slice(0, 20),
    contextSummary: `최근 14일 공개 관찰 ${group.postIds.size}건·독립 작성자 ${group.authorHashes.size}명·수집처 ${group.sourceIds.size}곳을 합산했습니다. AI 적격성 심사에서 review 판정을 받았으며 사람 검토로 최종 확정해야 합니다.`,
    evidence,
    positiveTests: group.evidence.filter((item) => ["direct_attack", "group_discrimination", "threat", "coded_reference"].includes(item.label)).map((item) => item.excerpt).slice(0, 5),
    negativeTests: [...group.evidence.filter((item) => ["quotation", "warning", "definition", "benign"].includes(item.label)).map((item) => item.excerpt), `“${group.expression}”이라는 표현은 사용하지 마세요.`].slice(0, 5),
    redTeam: "자동 발견 후보입니다. 인용·비판·동음이의 문맥을 반드시 확인하세요.",
    modelConflict: null,
    policyChange: null,
    draft: draft ?? previous.draft ?? null,
    qualification: { disposition: assessment.disposition, reason: assessment.reason, confidence: assessment.confidence, distinctAuthors: group.authorHashes.size, distinctSources: group.sourceIds.size, observationCount: group.postIds.size },
    lineage: { collectorSourceId: source.id, provider: source.provider, lastCollectedAt: now, observationWindowDays: 14 },
    sources,
    retentionDeadline: new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    autoInclusionBlockedReason: "자동 수집 데이터는 사람 검토와 회귀 테스트를 통과하기 전까지 활성 규칙에 반영되지 않습니다.",
  };
  await env.DB.prepare(`
    INSERT INTO riskshield_candidates (id, status, payload, created_at, updated_at)
    VALUES (?, 'pending', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).bind(candidateId, JSON.stringify(payload), String(payload.createdAt), now).run();
  return candidateId;
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
  let observationCount = 0;
  let monitoredCount = 0;
  let rejectedCount = 0;
  let candidateCount = 0;
  try {
    const fetched = await fetchPosts(source, env);
    fetchedCount = fetched.posts.length;
    const storedPosts: StoredPost[] = [];
    for (const post of fetched.posts.slice(0, MAX_POSTS_PER_RUN)) {
      if (!hasKoreanContent(post.text)) continue;
      const prepared = prepareInterpreterInput(post.text, 2_000);
      const excerpt = boundedExcerpt(prepared.modelText);
      if (!excerpt) continue;
      const postHash = await digestId(`${source.id}:${post.externalId}`);
      const postId = `collected_${postHash.slice(0, 32)}`;
      const authorHash = await authorHashFor(post, source, env);
      const inserted = await env.DB.prepare(`
        INSERT INTO riskshield_collected_posts_v3
          (id, source_id, provider, external_id, text, source_url, published_at, collected_at, author_hash, candidate_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(source_id, external_id) DO NOTHING
      `).bind(postId, source.id, source.provider, post.externalId, excerpt, post.url, post.publishedAt, startedAt, authorHash).run();
      if (!inserted.meta.changes) continue;
      newCount += 1;
      storedPosts.push({ ...post, postId, excerpt, authorHash });
    }
    const excluded = await knownExpressions(env.DB);
    for (const term of queryTerms(source.query)) excluded.add(term);
    observationCount = await saveObservations(storedPosts, source, excluded, env, startedAt);
    const groups = await recentExpressionGroups(env);
    const qualified = await qualifyExpressionGroups(groups, env);
    const reviewGroups: Array<{ group: ExpressionGroup; assessment: QualificationAssessment }> = [];
    for (const group of groups) {
      const assessment = qualified.assessments.get(group.normalized) ?? null;
      await persistAssessment(group, assessment, env, startedAt);
      if (!assessment || assessment.disposition === "monitor") { monitoredCount += 1; continue; }
      if (assessment.disposition === "reject") { rejectedCount += 1; continue; }
      if (passesQualification(group, assessment)) reviewGroups.push({ group, assessment });
      else monitoredCount += 1;
    }
    const drafted = await draftExpressionGroups(reviewGroups.map((item) => item.group), source, env, runId);
    for (const { group, assessment } of reviewGroups) {
      const candidateId = await candidateIdForExpression(group.normalized);
      await saveCandidate(group, source, env, startedAt, drafted.drafts.get(candidateId) ?? null, assessment);
      candidateCount += 1;
      const postIds = [...group.postIds];
      if (postIds.length) await env.DB.prepare(`UPDATE riskshield_collected_posts_v3 SET candidate_id = ? WHERE id IN (${postIds.map(() => "?").join(",")})`).bind(candidateId, ...postIds).run();
      await env.DB.prepare("UPDATE riskshield_expression_observations SET qualification_status = 'qualified', updated_at = ? WHERE normalized_expression = ? AND datetime(created_at) >= datetime('now', '-14 days')")
        .bind(startedAt, group.normalized).run();
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM riskshield_collected_posts_v3 WHERE datetime(collected_at) < datetime('now', '-30 days')"),
      env.DB.prepare("DELETE FROM riskshield_expression_observations WHERE datetime(created_at) < datetime('now', '-30 days')"),
    ]);
    const finishedAt = new Date().toISOString();
    const aiLabel = qualified.state === "ready" ? "AI 적격성 심사 완료" : qualified.state === "not_configured" ? "AI 미설정으로 후보 승격 없음" : `AI 심사 보류(${qualified.state})`;
    const message = `${fetchedCount}개 확인 · ${newCount}개 신규 · ${observationCount}개 관찰 · ${monitoredCount}개 모니터 · ${rejectedCount}개 기각 · ${candidateCount}개 검토 후보 · ${aiLabel}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO riskshield_collector_runs_v3 (id, source_id, status, fetched_count, new_count, observation_count, monitored_count, rejected_count, candidate_count, message, started_at, finished_at) VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(runId, source.id, fetchedCount, newCount, observationCount, monitoredCount, rejectedCount, candidateCount, message, startedAt, finishedAt),
      env.DB.prepare("UPDATE riskshield_collector_sources_v3 SET cursor = ?, last_run_at = ?, last_status = 'succeeded', last_message = ?, updated_at = ? WHERE id = ?")
        .bind(fetched.cursor, finishedAt, message, finishedAt, source.id),
    ]);
    return { runId, status: "succeeded" as const, fetchedCount, newCount, observationCount, monitoredCount, rejectedCount, candidateCount, message };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "수집 중 알 수 없는 오류가 발생했습니다.";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO riskshield_collector_runs_v3 (id, source_id, status, fetched_count, new_count, observation_count, monitored_count, rejected_count, candidate_count, message, started_at, finished_at) VALUES (?, ?, 'failed', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(runId, source.id, fetchedCount, newCount, observationCount, monitoredCount, rejectedCount, candidateCount, message, startedAt, finishedAt),
      env.DB.prepare("UPDATE riskshield_collector_sources_v3 SET last_run_at = ?, last_status = 'failed', last_message = ?, updated_at = ? WHERE id = ?")
        .bind(finishedAt, message, finishedAt, source.id),
    ]);
    return { runId, status: "failed" as const, fetchedCount, newCount, observationCount, monitoredCount, rejectedCount, candidateCount, message };
  }
}

export async function runDueCollectors(env: CollectorEnvironment) {
  const rows = await env.DB.prepare(`
    SELECT id, provider, label, query, endpoint, enabled, interval_minutes, cursor, last_run_at
    FROM riskshield_collector_sources_v3
    WHERE enabled = 1 AND (last_run_at IS NULL OR datetime(last_run_at, '+' || interval_minutes || ' minutes') <= datetime('now'))
    ORDER BY COALESCE(last_run_at, '') ASC LIMIT 12
  `).all<Record<string, unknown>>();
  const results = [];
  for (const row of rows.results ?? []) results.push(await runCollectorSource(sourceFromRow(row), env));
  return results;
}

export async function readCollectorSource(db: D1Database, id: string) {
  const row = await db.prepare("SELECT id, provider, label, query, endpoint, enabled, interval_minutes, cursor, last_run_at FROM riskshield_collector_sources_v3 WHERE id = ? LIMIT 1")
    .bind(id).first<Record<string, unknown>>();
  return row ? sourceFromRow(row) : null;
}
