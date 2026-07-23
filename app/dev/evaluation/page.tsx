import { EvaluationWorkbench } from "../../../components/developer/EvaluationWorkbench";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export async function renderEvaluationPage(returnTo = "/dev/evaluation") {
  const { principal, presentation } = await protectedProductPage(returnTo, "evaluation:run");
  return (
    <DeveloperShell
      currentHref="/dev/evaluation"
      principal={presentation}
      title="규칙 엔진 테스트"
      description="사람이 정답을 붙인 문장으로 현재 활성 규칙의 정확도·정밀도·재현율과 오탐·미탐을 확인합니다. AI를 포함한 전체 시스템 정확도나 보정 확률은 아닙니다."
    >
      <EvaluationWorkbench csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}

export default function EvaluationPage() { return renderEvaluationPage(); }
