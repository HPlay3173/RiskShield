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

  return (
    <AdminShell currentHref="/manage" principal={presentation} title="RiskShield 관리 홈" description="새 위험 표현을 모으고, 검토하고, 분석 지식으로 반영하는 전체 흐름을 한곳에서 관리합니다.">
      <section className="manageHero" aria-labelledby="next-action-title">
        <div><span className="manageHeroEyebrow">다음 추천 작업</span><h2 id="next-action-title">{nextLabel}</h2><p>{pending && pending > 0 ? `사람의 판단을 기다리는 후보가 ${pending}건 있습니다.` : "데이터를 등록하고 후보를 생성해 탐지 범위를 넓혀 보세요."}</p></div>
        <Link className="pressable primaryButton" href={nextHref}>{nextLabel}</Link>
      </section>
      <section className="metricGrid" aria-label="현재 시스템 상태">
        <div className="metricCard"><span>검토 대기 후보</span><strong className="metricValue">{pending ?? "—"}</strong><small>사람의 판단이 필요한 표현</small></div>
        <div className="metricCard"><span>활성 위험 규칙</span><strong className="metricValue">{active ?? "—"}</strong><small>공개 분석기에 반영되는 지식</small></div>
        <div className="metricCard"><span>등록 데이터</span><strong className="metricValue">{datasetCount ?? "—"}</strong><small>CSV와 수집 데이터 묶음</small></div>
        <div className="metricCard"><span>최근 품질 확인</span><strong className="metricValue">{latestEvaluation ? `${latestEvaluation.passed}/${latestEvaluation.testCount}` : "—"}</strong><small>{latestEvaluation?.status === "passed" ? "통과" : "아직 실행 기록 없음"}</small></div>
      </section>
      <section className="managementCard workflowCard" aria-labelledby="workflow-title">
        <div className="workflowHeading"><div><span className="manageHeroEyebrow">지속 강화 흐름</span><h2 id="workflow-title">데이터가 탐지 지식이 되는 과정</h2></div><p>AI는 후보를 만들고, 사람의 검토가 끝난 지식만 분석기에 반영됩니다.</p></div>
        <ol className="workflowMap">
          <li><span>1</span><div><strong>데이터 등록</strong><small>CSV·커뮤니티 자료를 추가</small><Link href="/manage/datasets">등록하기</Link></div></li>
          <li><span>2</span><div><strong>후보 생성</strong><small>새 표현과 변형을 추출</small><Link href="/manage/training">생성하기</Link></div></li>
          <li><span>3</span><div><strong>사람 검토</strong><small>의미·문맥·위험 범주 확인</small><Link href="/manage/review">검토하기</Link></div></li>
          <li><span>4</span><div><strong>위험 표현 DB</strong><small>승인된 규칙을 관리</small><Link href="/manage/skills">확인하기</Link></div></li>
          <li><span>5</span><div><strong>품질 확인</strong><small>탐지와 오탐을 점검</small><Link href="/manage/evaluation">검사하기</Link></div></li>
        </ol>
      </section>
      <section className="managementGrid">
        <article className="managementCard"><span className="manageHeroEyebrow">분석 지식</span><h2>무엇을 탐지하나요?</h2><div className="knowledgeChips"><span>과장·기만</span><span>혐오·차별</span><span>욕설·공격</span><span>숨은 은어</span><span>폭력·위협</span><span>개인정보 침해</span></div></article>
        <article className="managementCard"><span className="manageHeroEyebrow">사용 원칙</span><h2>AI 자동 등록은 하지 않습니다</h2><p>사용자 제보와 외부 자료는 모두 후보함에 저장됩니다. 의미와 문맥을 사람이 확인한 뒤에만 실제 분석 규칙으로 사용할 수 있습니다.</p><Link className="reviewInboxLink" href="/manage/review">검토함 열기 →</Link></article>
      </section>
    </AdminShell>
  );
}
