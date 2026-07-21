"use client";

import { FormEvent, useMemo, useState } from "react";
import { readCsvDataset } from "../../lib/datasets/csv";

function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function CommunityCollector({ csrfToken }: { csrfToken: string }) {
  const [sourceName, setSourceName] = useState("community-snapshot");
  const [sourceUrl, setSourceUrl] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [message, setMessage] = useState("");
  const posts = useMemo(() => [...new Set(text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))].slice(0, 2_000), [text]);

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
    <form className="communityCollector managementCard" onSubmit={submit}>
      <div className="collectorIntro"><div><span className="manageHeroEyebrow">SOURCE CONNECTOR MVP</span><h2>공개 글 묶음 등록</h2></div><span className="statusPill" data-tone="info">사람 검토 필수</span></div>
      <p>X·디시·Threads 등에서 이용 규칙을 지켜 확보한 공개 글을 한 줄에 하나씩 넣으세요. 사용자명과 링크의 개인정보는 넣지 말고, 원문은 바로 활성 규칙이 아닌 후보 생성용 데이터로만 저장됩니다.</p>
      <div className="collectorFields">
        <label className="formField">자료 이름<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={80} required /></label>
        <label className="formField">출처 주소 <small>선택</small><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." /></label>
      </div>
      <label className="formField">공개 글·댓글<textarea value={text} onChange={(event) => { setText(event.target.value); setState("idle"); }} rows={12} placeholder={"한 줄에 하나씩 입력\n예: 새로 등장한 은어가 포함된 공개 댓글"} /></label>
      <div className="collectorSummary"><span>입력 {text.split(/\r?\n/u).filter((line) => line.trim()).length}줄</span><span>중복 제거 후 {posts.length}개</span><span>최대 2,000개</span></div>
      <div className="trainingRunActions"><button className="pressable" type="submit" disabled={state === "saving" || posts.length === 0}>{state === "saving" ? "등록 중…" : "후보 생성용 데이터로 등록"}</button>{state === "saved" ? <a className="pressable secondaryButton" href="/manage/training">다음: 후보 생성</a> : null}</div>
      {message ? <p className={state === "failed" ? "configurationNote" : "collectorSuccess"} role={state === "failed" ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}
