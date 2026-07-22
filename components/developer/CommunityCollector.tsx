"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { readCsvDataset } from "../../lib/datasets/csv";
import { parseYouTubeVideoInput } from "../../lib/collectors/youtube";

function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function CommunityCollector({ csrfToken }: { csrfToken: string }) {
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [provider, setProvider] = useState<"youtube" | "bluesky" | "mastodon" | "x" | "threads" | "dcinside">("youtube");
  const [collectorLabel, setCollectorLabel] = useState("YouTube 한국어 댓글 관찰");
  const [query, setQuery] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(360);
  const [collectorState, setCollectorState] = useState<"idle" | "loading" | "failed">("idle");
  const [collectorMessage, setCollectorMessage] = useState("");
  const [sourceName, setSourceName] = useState("community-snapshot");
  const [sourceUrl, setSourceUrl] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [message, setMessage] = useState("");
  const posts = useMemo(() => [...new Set(text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))].slice(0, 2_000), [text]);
  const youtubeVideos = useMemo(() => parseYouTubeVideoInput(query), [query]);
  const youtubeInputInvalid = provider === "youtube" && Boolean(query.trim()) && (!youtubeVideos.ids.length || youtubeVideos.invalid.length > 0);

  const statusLabel = (value: unknown) => value === "succeeded" ? "완료" : value === "failed" ? "실패" : value === "running" ? "수집 중" : "대기";

  async function refreshCollectors() {
    const response = await fetch("/api/manage/collectors", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as { sources?: Array<Record<string, unknown>>; runs?: Array<Record<string, unknown>>; message?: string };
    if (!response.ok) throw new Error(payload.message ?? "자동 수집 상태를 읽지 못했습니다.");
    setSources(payload.sources ?? []); setRuns(payload.runs ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { refreshCollectors().catch(() => undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function saveCollector(event: FormEvent) {
    event.preventDefault(); setCollectorState("loading"); setCollectorMessage("");
    try {
      if (youtubeInputInvalid) throw new Error("영상 주소 또는 11자리 ID를 확인해 주세요.");
      const response = await fetch("/api/manage/collectors", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-riskshield-csrf": csrfToken }, body: JSON.stringify({ provider, label: collectorLabel, query, endpoint: endpoint || null, intervalMinutes, enabled: true }) });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "수집 설정을 저장하지 못했습니다.");
      setCollectorMessage(payload.message ?? "예약 수집을 켰습니다."); setCollectorState("idle"); await refreshCollectors();
    } catch (error) { setCollectorState("failed"); setCollectorMessage(error instanceof Error ? error.message : "수집 설정을 저장하지 못했습니다."); }
  }

  async function runCollector(sourceId: string) {
    setCollectorState("loading"); setCollectorMessage("");
    try {
      const response = await fetch("/api/manage/collectors/run", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-riskshield-csrf": csrfToken }, body: JSON.stringify({ sourceId }) });
      const payload = await response.json() as { message?: string; fetchedCount?: number; observationCount?: number; monitoredCount?: number; rejectedCount?: number; candidateCount?: number };
      if (!response.ok) throw new Error(payload.message ?? "수집을 실행하지 못했습니다.");
      setCollectorMessage(`${payload.fetchedCount ?? 0}개 확인 · ${payload.observationCount ?? 0}개 관찰 · ${payload.monitoredCount ?? 0}개 모니터 · ${payload.rejectedCount ?? 0}개 기각 · ${payload.candidateCount ?? 0}개 검토 후보`); setCollectorState("idle"); await refreshCollectors();
    } catch (error) { setCollectorState("failed"); setCollectorMessage(error instanceof Error ? error.message : "수집을 실행하지 못했습니다."); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!posts.length) { setState("failed"); setMessage("한 줄에 하나씩 공개 글이나 댓글을 입력해 주세요."); return; }
    setState("saving"); setMessage("");
    try {
      const csv = ["keyword,source,context", ...posts.map((post) => [csvCell(post), csvCell(sourceUrl || "manual-public-snapshot"), csvCell("community-public-post")].join(","))].join("\n");
      const bytes = new TextEncoder().encode(csv);
      const buffer = bytes.buffer as ArrayBuffer;
      const dataset = await readCsvDataset(buffer, { sourceName: `${sourceName}.csv`, previewRows: 0 });
      if (!dataset.inspection.canStage) throw new Error("공개 글 묶음을 데이터 형식으로 변환하지 못했습니다.");
      const response = await fetch("/api/manage/datasets/register", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-riskshield-csrf": csrfToken },
        body: JSON.stringify({
          source: { name: `${sourceName}.csv`, mediaType: "text/csv", lastModified: new Date().toISOString(), byteSize: dataset.inspection.byteSize, sha256: dataset.inspection.sha256, bytesBase64: toBase64(buffer) },
          inspection: { encoding: dataset.inspection.encoding, bom: dataset.inspection.bom, delimiter: dataset.inspection.delimiter, delimiterDetected: dataset.inspection.delimiterDetected, profile: dataset.inspection.profile, headers: dataset.inspection.headers, mapping: dataset.inspection.mapping, requiredFields: dataset.inspection.requiredFields, rowCount: dataset.inspection.rowCount, validRowCount: dataset.inspection.validRowCount, issueCounts: dataset.inspection.issueCounts },
          provenance: { owner: "RiskShield project team", license: "public-source-review-required", purpose: "새 위험 표현 후보 발견과 사람 검토", retention: "프로젝트 검토 완료 시까지" },
          warningsAcknowledged: true,
        }),
      });
      const payload = await response.json() as { message?: string; datasetVersionId?: string };
      if (!response.ok) throw new Error(payload.message ?? "등록하지 못했습니다.");
      setState("saved"); setMessage(`${posts.length}개의 공개 글을 등록했습니다. 버전: ${payload.datasetVersionId ?? "생성 완료"}`);
    } catch (error) { setState("failed"); setMessage(error instanceof Error ? error.message : "등록하지 못했습니다."); }
  }

  return (
    <>
    <form className="communityCollector managementCard" onSubmit={saveCollector}>
      <div className="collectorIntro"><div><span className="manageHeroEyebrow">예약 수집</span><h2>자동 커뮤니티 수집</h2></div><span className="statusPill" data-tone="success">{intervalMinutes === 1440 ? "하루마다" : intervalMinutes >= 60 ? `${intervalMinutes / 60}시간마다` : `${intervalMinutes}분마다`} 확인</span></div>
      <p>수집 글은 바로 후보가 되지 않습니다. 최근 14일 관찰을 합쳐 독립 작성자와 직접 위험 문맥을 확인하고, AI가 정상 단어를 기각하거나 모니터링한 뒤 통과한 표현만 검토함으로 보냅니다.</p>
      <div className="collectorFields">
        <label className="formField">수집처<select value={provider} onChange={(event) => { const next = event.target.value as typeof provider; setProvider(next); setEndpoint(next === "mastodon" ? "https://mastodon.social" : ""); setQuery(next === "youtube" ? "" : next === "mastodon" ? "혐오표현" : "혐오 OR 비하 OR 은어"); setCollectorLabel(next === "youtube" ? "YouTube 한국어 댓글 관찰" : "새 위험 표현 모니터"); }}><option value="youtube">YouTube 공개 댓글 · 주요 표본</option><option value="bluesky">Bluesky 공개 검색 · 보조 관찰</option><option value="mastodon">Mastodon 공개 해시태그 · 보조 관찰</option><option value="threads">Threads 공식 API · 토큰 필요</option><option value="x">X 공식 API · 토큰/비용 필요</option><option value="dcinside">디시인사이드 승인 피드 · 실험</option></select></label>
        <label className="formField">수집 이름<input value={collectorLabel} onChange={(event) => setCollectorLabel(event.target.value)} maxLength={80} required /></label>
        <label className="formField collectorQueryField">{provider === "youtube" ? "YouTube 영상 주소 또는 ID" : "검색어"}{provider === "youtube" ? <textarea value={query} onChange={(event) => setQuery(event.target.value)} maxLength={1_000} rows={3} placeholder={"https://www.youtube.com/watch?v=…\nhttps://youtu.be/…"} aria-invalid={youtubeInputInvalid} required /> : <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={240} required />}<small>{provider === "youtube" ? "영상 페이지 주소를 그대로 붙여넣으세요. 일반 영상·Shorts·Live 주소와 11자리 ID를 최대 5개까지 인식합니다." : "메타 단어 검색 결과는 직접 위험 사용이 확인되기 전까지 후보가 되지 않습니다."}</small>{provider === "youtube" && query.trim() ? <span className={youtubeInputInvalid ? "fieldValidation fieldValidationError" : "fieldValidation"}>{youtubeInputInvalid ? `인식하지 못한 항목 ${youtubeVideos.invalid.length || 1}개` : `${youtubeVideos.ids.length}개 영상 인식됨${query.split(/[\s,]+/u).filter(Boolean).length > youtubeVideos.ids.length ? " · 중복 제거됨" : ""}`}</span> : null}</label>
        <label className="formField">확인 간격<select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value={15}>15분</option><option value={60}>1시간</option><option value={360}>6시간</option><option value={1440}>하루</option></select></label>
      </div>
      {provider === "mastodon" ? <label className="formField">공개 Mastodon 인스턴스<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://mastodon.social" required /><small>검색어에는 #을 제외한 해시태그 하나만 입력하세요.</small></label> : null}
      {provider === "dcinside" ? <label className="formField">공개 피드·검색 주소<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://...dcinside.com/.../{query}" required /></label> : null}
      <div className="trainingRunActions"><button className="pressable" type="submit" disabled={collectorState === "loading" || youtubeInputInvalid}>{collectorState === "loading" ? "처리 중…" : "예약 수집 켜기"}</button></div>
      {collectorMessage ? <p className={collectorState === "failed" ? "configurationNote" : "collectorSuccess"} role={collectorState === "failed" ? "alert" : "status"}>{collectorMessage}</p> : null}
      <div className="collectorSourceList">{sources.length ? sources.map((source) => <article key={String(source.id)}><div><strong>{String(source.label)}</strong><span>{String(source.provider).toUpperCase()} · {String(source.query)}</span></div><div><span className="statusPill" data-tone={source.last_status === "failed" ? "critical" : source.last_status === "succeeded" ? "success" : "info"}>{statusLabel(source.last_status)}</span><button className="pressable secondaryButton" type="button" onClick={() => runCollector(String(source.id))} disabled={collectorState === "loading"}>지금 수집</button></div><small>{source.last_message ? String(source.last_message) : "아직 실행 기록이 없습니다."}</small></article>) : <p className="analysisMethodNote">등록된 자동 수집처가 없습니다. YouTube 공개 댓글을 주요 표본으로, Bluesky·Mastodon은 보조 관찰로 연결해 보세요.</p>}</div>
      {runs.length ? <p className="analysisMethodNote">최근 실행 {runs.length}건 · 마지막 실행 {String(runs[0]?.finished_at ?? "없음")}</p> : null}
    </form>
    <details className="managementCard secondaryWorkflow">
      <summary><span><small>직접 가져온 자료가 있나요?</small><strong>공개 글 묶음 직접 등록</strong></span><b>열기</b></summary>
    <form className="communityCollector" onSubmit={submit}>
      <div className="collectorIntro"><div><span className="manageHeroEyebrow">수동 등록</span><h2>공개 글 묶음 등록</h2></div><span className="statusPill" data-tone="info">사람 검토 필수</span></div>
      <p>X·디시·Threads·Bluesky·Mastodon 등에서 이용 규칙을 지켜 확보한 공개 글을 한 줄에 하나씩 넣으세요. 사용자명과 링크의 개인정보는 넣지 말고, 원문은 바로 활성 규칙이 아닌 후보 생성용 데이터로만 저장됩니다.</p>
      <div className="collectorFields">
        <label className="formField">자료 이름<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={80} required /></label>
        <label className="formField">출처 주소 <small>선택</small><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." /></label>
      </div>
      <label className="formField">공개 글·댓글<textarea value={text} onChange={(event) => { setText(event.target.value); setState("idle"); }} rows={12} placeholder={"한 줄에 하나씩 입력\n예: 새로 등장한 은어가 포함된 공개 댓글"} /></label>
      <div className="collectorSummary"><span>입력 {text.split(/\r?\n/u).filter((line) => line.trim()).length}줄</span><span>중복 제거 후 {posts.length}개</span><span>최대 2,000개</span></div>
      <div className="trainingRunActions"><button className="pressable" type="submit" disabled={state === "saving" || posts.length === 0}>{state === "saving" ? "등록 중…" : "후보 생성용 데이터로 등록"}</button>{state === "saved" ? <a className="pressable secondaryButton" href="/manage/training">다음: 후보 생성</a> : null}</div>
      {message ? <p className={state === "failed" ? "configurationNote" : "collectorSuccess"} role={state === "failed" ? "alert" : "status"}>{message}</p> : null}
    </form>
    </details>
    </>
  );
}
