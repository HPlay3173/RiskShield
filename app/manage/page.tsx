import Link from "next/link";
import { AdminShell } from "../../components/shell/AreaShells";
import { protectedProductPage } from "../../lib/product-page";

export default async function ManagePage() {
  const { presentation, repositories } = await protectedProductPage("/manage", "candidate:read");
  const [candidates, skills, datasets, evaluations] = await Promise.all([
    repositories.candidates.list(), repositories.skills.listAdmin({ limit: 100 }), repositories.datasets.list(), repositories.evaluation.listRuns(),
  ]);
  const pending = candidates.status === "ready" ? candidates.data.items.filter((item) => item.status === "pending").length : null;
  const active = skills.status === "ready" ? skills.data.items.filter((item) => item.active === true || item.reviewStatus === "reviewed").length : null;
  const datasetCount = datasets.status === "ready" ? datasets.data.items.length : null;
  const latestEvaluation = evaluations.status === "ready" ? evaluations.data.items[0] : null;
  const nextHref = pending && pending > 0 ? "/manage/review" : datasetCount ? "/manage/training" : "/manage/datasets";
  const nextLabel = pending && pending > 0 ? "검토 대기 후보 확인" : datasetCount ? "후보 생성 시작" : "첫 데이터 등록";
  const nextDescription = pending && pending > 0
    ? `사람의 판단을 기다리는 후보가 ${pending}건 있습니다. 가장 오래 기다린 후보부터 확인해 보세요.`
    : datasetCount
      ? "등록한 자료에서 새로운 위험 표현 후보를 찾아 검토함으로 보냅니다."
      : "CSV나 공개 글 묶음을 등록하면 새로운 위험 표현을 찾을 수 있습니다.";

  return (
    <AdminShell currentHref="/manage" principal={presentation} title="RiskShield 관리 홈" description="새 위험 표현을 모으고, 검토하고, 분석 지식으로 반영하는 전체 흐름을 한곳에서 관리합니다.">
      <section className="manageHero" aria-labelledby="next-action-title">
        <div><span className="manageHeroEyebrow">지금 하면 좋은 일</span><h2 id="next-action-title">{nextLabel}</h2><p>{nextDescription}</p></div>
        <Link className="pressable primaryButton" href={nextHref}>{nextLabel}</Link>
      </section>
      <section className="metricGrid" aria-label="현재 시스템 상태">
        <div className="metricCard"><span>검토 대기 후보</span><strong className="metricValue">{pending ?? "—"}</strong><small>사람의 판단이 필요한 표현</small></div>
        <div className="metricCard"><span>활성 위험 규칙</span><strong className="metricValue">{active ?? "—"}</strong><small>공개 분석기에 반영되는 지식</small></div>
        <div className="metricCard"><span>등록 데이터</span><strong className="metricValue">{datasetCount ?? "—"}</strong><small>CSV와 수집 데이터 묶음</small></div>
        <div className="metricCard"><span>최근 품질 기록</span><strong className="metricValue">{latestEvaluation ? `${latestEvaluation.passed}/${latestEvaluation.testCount}` : "—"}</strong><small>{latestEvaluation?.status === "passed" ? "저장된 검증 통과" : "아직 저장된 기록 없음"}</small></div>
      </section>
      <section className="managementCard workflowCard" aria-labelledby="workflow-title">
        <div className="workflowHeading"><div><span className="manageHeroEyebrow">지속 강화 흐름</span><h2 id="workflow-title">데이터가 탐지 지식이 되는 과정</h2></div><p>AI는 후보를 만들고, 사람의 검토가 끝난 지식만 분석기에 반영됩니다.</p></div>
        <ol className="workflowMap">
          <li data-state={datasetCount ? "complete" : "next"}><span>1</span><div><strong>데이터 등록</strong><small>CSV·커뮤니티 자료를 추가</small><Link href="/manage/datasets">등록하기</Link></div></li>
          <li data-state={datasetCount && !pending ? "next" : datasetCount ? "complete" : "waiting"}><span>2</span><div><strong>후보 생성</strong><small>새 표현과 변형을 추출</small><Link href="/manage/training">생성하기</Link></div></li>
          <li data-state={pending ? "next" : "waiting"}><span>3</span><div><strong>사람 검토</strong><small>의미·문맥·위험 범주 확인</small><Link href="/manage/review">검토하기</Link></div></li>
          <li data-state={active ? "complete" : "waiting"}><span>4</span><div><strong>위험 표현 DB</strong><small>승인된 규칙을 관리</small><Link href="/manage/skills">확인하기</Link></div></li>
          <li data-state={latestEvaluation ? "complete" : "waiting"}><span>5</span><div><strong>품질 기록</strong><small>저장된 검증 결과 확인</small><Link href="/manage/evaluation">기록 보기</Link></div></li>
        </ol>
      </section>
      <section className="managementTaskGrid" aria-label="빠른 작업">
        <Link className="managementTaskCard" href="/manage/review"><span>01 · 검토</span><strong>새 표현 판단하기</strong><p>위험 범주와 문맥을 확인하고 규칙 초안을 만듭니다.</p><b>{pending ?? "—"}건 대기 →</b></Link>
        <Link className="managementTaskCard" href="/manage/skills"><span>02 · 지식</span><strong>활성 규칙 살펴보기</strong><p>분석기가 지금 사용하는 표현과 반례를 확인합니다.</p><b>{active ?? "—"}개 활성 →</b></Link>
        <Link className="managementTaskCard" href="/manage/training"><span>03 · 발견</span><strong>데이터에서 후보 찾기</strong><p>등록한 자료 하나를 선택해 검토 후보를 생성합니다.</p><b>후보 생성 시작 →</b></Link>
      </section>
      <section className="managementGrid">
        <article className="managementCard"><span className="manageHeroEyebrow">분석 지식</span><h2>무엇을 탐지하나요?</h2><div className="knowledgeChips"><span>과장·기만</span><span>혐오·차별</span><span>욕설·공격</span><span>숨은 은어</span><span>폭력·위협</span><span>개인정보 침해</span></div></article>
        <article className="managementCard"><span className="manageHeroEyebrow">사람 중심 검토</span><h2>AI가 바로 규칙을 바꾸지 않습니다</h2><p>사용자 제보와 외부 자료는 후보함으로 들어옵니다. 사람이 의미와 반례를 확인하고 회귀 검증을 통과한 지식만 분석기에 반영됩니다.</p><Link className="reviewInboxLink" href="/manage/review">검토함 열기 →</Link></article>
      </section>
      <section className="managementCard roadmapCard" aria-labelledby="roadmap-title">
        <div><span className="manageHeroEyebrow">후속 확장</span><h2 id="roadmap-title">현재 핵심 흐름과 분리한 다음 단계</h2><p>아래 기능은 메뉴에서 제거한 미완성 기능입니다. 지금 작동하는 기능처럼 보이지 않도록 로드맵으로만 표시합니다.</p></div>
        <ul><li>커뮤니티 실시간 자동 수집</li><li>완전한 다중 claim 글 전체 점수</li><li>실제 평가 데이터 기반 정확도 보정</li></ul>
      </section>
    </AdminShell>
  );
}
