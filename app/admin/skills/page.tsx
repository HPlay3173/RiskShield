import { SkillLibrary, type SerializableJson, type SkillLibraryItem } from "../../../components/admin/SkillLibrary";
import { AdminShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { SkillAdminRecord } from "../../../lib/repositories/contracts";
import type { RiskSkill } from "../../../lib/riskshield";

function skillView(record: SkillAdminRecord, activeIds: ReadonlySet<string>): SkillLibraryItem | null {
  if (!record.payload || record.reviewStatus === "invalid") return null;
  return {
    id: record.id,
    name: record.payload.surfaceMeaning,
    category: record.category,
    subcategory: record.payload.subcategory || null,
    reviewStatus: record.reviewStatus,
    score: record.severityFloor,
    sourceCount: record.sourceCount,
    revision: record.payload.revision,
    updatedAt: record.updatedAt,
    active: activeIds.has(record.id),
    automaticallyVerified: record.payload.recentContextTags?.includes("auto_verified") ?? false,
    humanReviewPending: record.payload.recentContextTags?.includes("human_review_pending") ?? false,
    payload: record.payload as unknown as SerializableJson,
    regressionTests: (record.payload.regressionTests ?? []).map((regressionCase) => ({
      ...regressionCase,
      contextSlice: regressionCase.contextSlice ?? null,
      actual: null,
      passed: null,
    })),
  };
}

function activeSkillView(skill: RiskSkill): SkillLibraryItem {
  return {
    id: skill.id,
    name: skill.surfaceMeaning,
    category: skill.category,
    subcategory: skill.subcategory || null,
    reviewStatus: "reviewed",
    score: skill.severityFloor,
    sourceCount: skill.source ? 1 : null,
    revision: skill.revision,
    updatedAt: skill.updatedAt,
    active: true,
    automaticallyVerified: skill.recentContextTags?.includes("auto_verified") ?? false,
    humanReviewPending: skill.recentContextTags?.includes("human_review_pending") ?? false,
    payload: skill as unknown as SerializableJson,
    regressionTests: (skill.regressionTests ?? []).map((regressionCase) => ({
      ...regressionCase,
      contextSlice: regressionCase.contextSlice ?? null,
      actual: null,
      passed: null,
    })),
  };
}

export async function renderAdminSkillsPage(returnTo = "/admin/skills") {
  const { principal, presentation, repositories } = await protectedProductPage(returnTo, "skill:read_admin");
  const [result, activeResult] = await Promise.all([
    repositories.skills.listAdmin({ limit: 100 }),
    repositories.skills.listReviewed(),
  ]);
  if (result.status !== "ready") {
    return (
      <AdminShell currentHref="/admin/skills" principal={presentation} title="위험 표현 DB" description="분석기가 사용하는 탐지 규칙과 상태를 확인합니다.">
        <StatePanel state={result.status === "configuration_required" ? "configuration-required" : "unavailable"} title="실제 스킬 저장소를 읽을 수 없습니다." description={result.message} />
      </AdminShell>
    );
  }
  const activeSkills = activeResult.status === "ready" ? [...activeResult.data] : [];
  const activeIds = new Set(activeSkills.map((skill) => skill.id));
  const storedSkills = result.data.items.map((record) => skillView(record, activeIds)).filter((item): item is SkillLibraryItem => item !== null);
  const storedIds = new Set(storedSkills.map((skill) => skill.id));
  const runtimeOnlySkills = activeSkills.filter((skill) => !storedIds.has(skill.id)).map(activeSkillView);
  const skills = [...storedSkills, ...runtimeOnlySkills];
  const invalidCount = result.data.items.length - storedSkills.length;
  return (
    <AdminShell currentHref="/admin/skills" principal={presentation} title="위험 표현 DB" description="활성 규칙과 초안을 확인하고, 테스트를 통과한 초안만 공개 분석기에 반영합니다.">
      <SkillLibrary
        skills={skills}
        revisionEndpoint="/api/manage/skills/revisions"
        activationEndpoint="/api/manage/skills/activate"
        deactivationEndpoint="/api/manage/skills/deactivate"
        csrfToken={principal.csrfToken}
        developmentFixture={result.fixture}
        degradedMessage={invalidCount ? `검증할 수 없는 payload ${invalidCount}건은 상세 목록에서 제외했습니다.` : result.fixture ? "개발 데이터입니다. production D1을 변경하지 않습니다." : null}
      />
    </AdminShell>
  );
}

export default function AdminSkillsPage() {
  return renderAdminSkillsPage();
}
