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
  const nextHref = pending && pending > 0 ? "/manage/review" : datasetCount ? "/manage/training" : "/manage/materials";
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
        <div className="metricCard"><span>최근 규칙 테스트</span><strong className="metricValue">{latestEvaluation ? `${latestEvaluation.passed}/${latestEvaluation.testCount}` : "—"}</strong><small>{latestEvaluation?.status === "passed" ? "규칙 엔진 테스트 통과" : "아직 실행한 테스트 없음"}</small></div>
      </section>
      <section className="managementCard workflowCard" aria-labelledby="workflow-title">
        <div className="workflowHeading"><div><span className="manageHeroEyebrow">지속 강화 흐름</span><h2 id="workflow-title">데이터가 탐지 지식이 되는 과정</h2></div><p>AI는 후보를 만들고, 사람의 검토가 끝난 지식만 분석기에 반영됩니다.</p></div>
        <ol className="workflowMap">
          <li data-state={datasetCount ? "complete" : "next"}><span>1</span><div><strong>자료 추가</strong><small>CSV·공개 글 자료를 추가</small><Link href="/manage/materials">등록하기</Link></div></li>
          <li data-state={datasetCount && !pending ? "next" : datasetCount ? "complete" : "waiting"}><span>2</span><div><strong>후보 생성</strong><small>새 표현과 변형을 추출</small><Link href="/manage/training">생성하기</Link></div></li>
          <li data-state={pending ? "next" : "waiting"}><span>3</span><div><strong>사람 검토</strong><small>의미·문맥·위험 범주 확인</small><Link href="/manage/review">검토하기</Link></div></li>
          <li data-state={active ? "complete" : "waiting"}><span>4</span><div><strong>위험 표현 DB</strong><small>승인된 규칙을 관리</small><Link href="/manage/skills">확인하기</Link></div></li>
          <li data-state={latestEvaluation ? "complete" : "waiting"}><span>5</span><div><strong>규칙 테스트</strong><small>탐지·오탐 사례로 품질 확인</small><Link href="/manage/test">테스트 시작</Link></div></li>
        </ol>
      </section>
      <section className="managementTaskGrid" aria-label="빠른 작업">
        <Link className="managementTaskCard" href="/manage/review"><span>01 · 검토</span><strong>새 표현 판단하기</strong><p>위험 범주와 문맥을 확인하고 규칙 초안을 만듭니다.</p><b>{pending ?? "—"}건 대기 →</b></Link>
        <Link className="managementTaskCard" href="/manage/skills"><span>02 · 지식</span><strong>활성 규칙 살펴보기</strong><p>분석기가 지금 사용하는 표현과 반례를 확인합니다.</p><b>{active ?? "—"}개 활성 →</b></Link>
        <Link className="managementTaskCard" href="/manage/materials"><span>03 · 자료</span><strong>새 표현 자료 추가</strong><p>CSV나 공개 글 묶음을 등록하고 후보 생성으로 이어갑니다.</p><b>자료 추가 →</b></Link>
      </section>
      <section className="managementGrid">
        <article className="managementCard"><span className="manageHeroEyebrow">분석 지식</span><h2>무엇을 탐지하나요?</h2><div className="knowledgeChips"><span>과장·기만</span><span>혐오·차별</span><span>욕설·공격</span><span>숨은 은어</span><span>폭력·위협</span><span>개인정보 침해</span></div></article>
        <article className="managementCard"><span className="manageHeroEyebrow">사람 중심 검토</span><h2>AI가 바로 규칙을 바꾸지 않습니다</h2><p>사용자 제보와 외부 자료는 후보함으로 들어옵니다. 사람이 의미와 반례를 확인하고 회귀 검증을 통과한 지식만 분석기에 반영됩니다.</p><Link className="reviewInboxLink" href="/manage/review">검토함 열기 →</Link></article>
      </section>
      <section className="managementCard roadmapCard" aria-labelledby="roadmap-title">
        <div><span className="manageHeroEyebrow">현재 실험 기능</span><h2 id="roadmap-title">자동 수집은 Labs에서 분리해 운영합니다</h2><p>자동 수집 결과는 곧바로 규칙이 되지 않으며, 의미·검색 검증과 사람 검토를 모두 통과해야 합니다.</p></div>
        <ul><li>검토 전 자동 반영 없음</li><li>출처별 품질 관찰</li><li><Link href="/manage/labs">Labs 열기</Link></li></ul>
      </section>
    </AdminShell>
  );
}
