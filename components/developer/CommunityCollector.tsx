"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { readCsvDataset } from "../../lib/datasets/csv";

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
  const [provider, setProvider] = useState<"bluesky" | "mastodon" | "x" | "threads" | "dcinside">("bluesky");
  const [collectorLabel, setCollectorLabel] = useState("새 위험 표현 모니터");
  const [query, setQuery] = useState("혐오 OR 비하 OR 은어");
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
      const payload = await response.json() as { message?: string; fetchedCount?: number; candidateCount?: number };
      if (!response.ok) throw new Error(payload.message ?? "수집을 실행하지 못했습니다.");
      setCollectorMessage(`${payload.fetchedCount ?? 0}개 확인 · ${payload.candidateCount ?? 0}개 검토 후보 생성`); setCollectorState("idle"); await refreshCollectors();
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
      <div className="collectorIntro"><div><span className="manageHeroEyebrow">SCHEDULED CONNECTORS</span><h2>자동 커뮤니티 수집</h2></div><span className="statusPill" data-tone="success">15분마다 예약 확인</span></div>
      <p>Bluesky와 공개 Mastodon은 별도 유료 키 없이 정기 수집할 수 있습니다. 원문 전체를 후보로 만들지 않고 반복·변형 표현을 최대 12개 표현군으로 압축하며, 개인정보를 가린 짧은 문맥만 30일 보존합니다.</p>
      <div className="collectorFields">
        <label className="formField">수집처<select value={provider} onChange={(event) => { const next = event.target.value as typeof provider; setProvider(next); setEndpoint(next === "mastodon" ? "https://mastodon.social" : ""); setQuery(next === "mastodon" ? "혐오표현" : "혐오 OR 비하 OR 은어"); }}><option value="bluesky">Bluesky 공개 검색 · 무료</option><option value="mastodon">Mastodon 공개 해시태그 · 무료</option><option value="threads">Threads 공식 API · 토큰 필요</option><option value="x">X 공식 API · 토큰/비용 필요</option><option value="dcinside">디시인사이드 공개 주소 · 실험</option></select></label>
        <label className="formField">수집 이름<input value={collectorLabel} onChange={(event) => setCollectorLabel(event.target.value)} maxLength={80} required /></label>
        <label className="formField">검색어<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={240} required /></label>
        <label className="formField">확인 간격<select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value={15}>15분</option><option value={60}>1시간</option><option value={360}>6시간</option><option value={1440}>하루</option></select></label>
      </div>
      {provider === "mastodon" ? <label className="formField">공개 Mastodon 인스턴스<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://mastodon.social" required /><small>검색어에는 #을 제외한 해시태그 하나만 입력하세요.</small></label> : null}
      {provider === "dcinside" ? <label className="formField">공개 피드·검색 주소<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://...dcinside.com/.../{query}" required /></label> : null}
      <div className="trainingRunActions"><button className="pressable" type="submit" disabled={collectorState === "loading"}>{collectorState === "loading" ? "처리 중…" : "예약 수집 켜기"}</button></div>
      {collectorMessage ? <p className={collectorState === "failed" ? "configurationNote" : "collectorSuccess"} role={collectorState === "failed" ? "alert" : "status"}>{collectorMessage}</p> : null}
      <div className="collectorSourceList">{sources.length ? sources.map((source) => <article key={String(source.id)}><div><strong>{String(source.label)}</strong><span>{String(source.provider).toUpperCase()} · {String(source.query)}</span></div><div><span className="statusPill" data-tone={source.last_status === "failed" ? "critical" : source.last_status === "succeeded" ? "success" : "info"}>{source.last_status ? String(source.last_status) : "대기"}</span><button className="pressable secondaryButton" type="button" onClick={() => runCollector(String(source.id))} disabled={collectorState === "loading"}>지금 수집</button></div><small>{source.last_message ? String(source.last_message) : "아직 실행 기록이 없습니다."}</small></article>) : <p className="analysisMethodNote">등록된 자동 수집처가 없습니다. 무료 공개 API부터 연결하면 토큰 없이 시작할 수 있습니다.</p>}</div>
      {runs.length ? <p className="analysisMethodNote">최근 실행 {runs.length}건 · 마지막 실행 {String(runs[0]?.finished_at ?? "없음")}</p> : null}
    </form>
    <form className="communityCollector managementCard" onSubmit={submit}>
      <div className="collectorIntro"><div><span className="manageHeroEyebrow">SOURCE CONNECTOR MVP</span><h2>공개 글 묶음 등록</h2></div><span className="statusPill" data-tone="info">사람 검토 필수</span></div>
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
    </>
  );
}
