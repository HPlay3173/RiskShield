import { describe, expect, it } from "vitest";
import { analyzeWithReviewedRules } from "./analyzer";

describe("5·18 hidden-context signals", () => {
  it.each([
    "오늘의 행운 숫자 518, 지금 특별 혜택을 만나보세요.",
    "이번 주말은 탱크데이! 한정 상품을 공개합니다.",
  ])("flags an unexplained hidden signal for review: %s", (input) => {
    const result = analyzeWithReviewedRules(input);
    expect(result.status).toBe("review");
    expect(result.matches.some((match) => match.skill.id === "risk_history_000002")).toBe(true);
  });

  it("flags a 5·18 tank promotion as high risk", () => {
    const result = analyzeWithReviewedRules("5/18 탱크데이, 오늘만 전 제품 특별 할인!");
    expect(result.status).toBe("high");
    expect(result.matches.some((match) => match.skill.id === "risk_history_000003")).toBe(true);
  });

  it.each([
    "다음 회의는 5/18 오후 3시입니다.",
    "수업에서 5·18 민주화운동의 역사적 의미를 배웁니다.",
    "기사는 5·18 탱크데이 논란과 행사 중단을 보도했다.",
  ])("does not flag an explained or critical context: %s", (input) => {
    expect(analyzeWithReviewedRules(input).status).toBe("no_match");
  });
});
