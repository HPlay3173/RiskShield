import { SkillLibrary, type SerializableJson, type SkillLibraryItem } from "../../../components/admin/SkillLibrary";
import { AdminShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { SkillAdminRecord } from "../../../lib/repositories/contracts";

function skillView(record: SkillAdminRecord): SkillLibraryItem | null {
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
    active: record.active ?? record.reviewStatus === "reviewed",
    payload: record.payload as unknown as SerializableJson,
    regressionTests: [],
  };
}

export async function renderAdminSkillsPage(returnTo = "/admin/skills") {
  const { principal, presentation, repositories } = await protectedProductPage(returnTo, "skill:read_admin");
  const result = await repositories.skills.listAdmin({ limit: 100 });
  if (result.status !== "ready") {
    return (
      <AdminShell currentHref="/admin/skills" principal={presentation} title="스킬 라이브러리" description="관리자에게만 전체 payload와 revision 흐름을 제공합니다.">
        <StatePanel state={result.status === "configuration_required" ? "configuration-required" : "unavailable"} title="실제 스킬 저장소를 읽을 수 없습니다." description={result.message} />
      </AdminShell>
    );
  }
  const skills = result.data.items.map(skillView).filter((item): item is SkillLibraryItem => item !== null);
  const invalidCount = result.data.items.length - skills.length;
  return (
    <AdminShell currentHref="/admin/skills" principal={presentation} title="스킬 라이브러리" description="실제 risk_skills read adapter로 검색·상세·payload를 확인하고 기존 값을 덮어쓰지 않는 revision을 제안합니다.">
      <SkillLibrary
        skills={skills}
        revisionEndpoint="/api/manage/skills/revisions"
        activationEndpoint="/api/manage/skills/activate"
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
