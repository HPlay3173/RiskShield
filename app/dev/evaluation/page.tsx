import { EvaluationWorkbench } from "../../../components/developer/EvaluationWorkbench";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export async function renderEvaluationPage(returnTo = "/dev/evaluation") {
  const { principal, presentation } = await protectedProductPage(returnTo, "evaluation:run");
  return (
    <DeveloperShell
      currentHref="/dev/evaluation"
      principal={presentation}
      title="품질 확인"
      description="사람이 정답을 붙인 실제 문장으로 현재 활성 규칙의 정확도·오탐·미탐을 측정하고, 최소 표본 기준을 통과한 점수 보정만 선택적으로 적용합니다."
    >
      <EvaluationWorkbench csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}

export default function EvaluationPage() { return renderEvaluationPage(); }
