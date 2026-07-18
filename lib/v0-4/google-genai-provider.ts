import type { LiveProvider, LiveProviderResult } from "./interpreter.ts";

export const GEMMA_LIVE_PILOT_MODEL = "gemma-4-26b-a4b-it" as const;
export const GOOGLE_GENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta" as const;
const FUNCTION_NAME = "submit_riskshield_interpretation";
const INPUT_START_MARKER = "\n입력 시작\n";
const INPUT_END_MARKER = "\n입력 끝";

interface ProviderEnvironment {
  RISKSHIELD_INTERPRETER_API_KEY?: string;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: { name?: string; args?: unknown };
      }>;
    };
  }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleGenAiHttpError extends Error {
  readonly status: number;
  readonly resourceExhausted: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, retryAfterSeconds: number | null = null) {
    super(status === 429
      ? `Google GenAI RESOURCE_EXHAUSTED (429)${retryAfterSeconds === null ? "" : `; retry_after_seconds=${retryAfterSeconds}`}`
      : `Google GenAI HTTP ${status}`);
    this.name = "GoogleGenAiHttpError";
    this.status = status;
    this.resourceExhausted = status === 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfterSeconds(value: string | null) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function asFunctionParametersJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  function convert(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (key === "const") {
        target.enum = [child];
      } else {
        target[key] = convert(child);
      }
    }
    return target;
  }
  return convert(schema) as Record<string, unknown>;
}

function gemmaFunctionInstruction(userPrompt: string) {
  const start = userPrompt.indexOf(INPUT_START_MARKER);
  const end = userPrompt.lastIndexOf(INPUT_END_MARKER);
  const input = start >= 0 && end > start
    ? userPrompt.slice(start + INPUT_START_MARKER.length, end)
    : "";
  return `
Gemma function calling 추가 규칙:
- submit_riskshield_interpretation 함수를 정확히 한 번 호출하세요.
- evidence_quotes에는 "입력 시작"과 "입력 끝" 사이 분석 대상에서 그대로 복사한 연속 문자열만 넣으세요.
- 공백, 조사, 문장부호를 바꾸거나 요약·교정하지 마세요. 분석 대상에 정확히 존재하지 않는 문자열은 넣지 마세요.
- start/end offset은 생성하지 마세요. 애플리케이션이 exact substring 검색으로 계산합니다.
- 분석 대상 UTF-16 길이는 ${input.length}입니다.
- speech_act가 warning, criticism, report, quote, definition, condition 중 하나이면 risk_intent는 반드시 contextual_only이고 evidence_quotes는 반드시 빈 배열입니다.
- direct_promotional은 광고주가 직접 광고·홍보하는 claim에만 사용하며 speech_act=claim, context_relation=supports여야 합니다.
- 위험 주장을 경고·비판·인용·보도·정의하거나 조건부로 설명하는 문장은 표현 안에 위험 단어가 있어도 절대 direct_promotional이 아닙니다.`;
}

export class GoogleGenAiProvider implements LiveProvider {
  readonly id = "google-genai-native-rest";
  private readonly apiKey: string;
  private readonly model: typeof GEMMA_LIVE_PILOT_MODEL;

  constructor(apiKey: string, model: typeof GEMMA_LIVE_PILOT_MODEL = GEMMA_LIVE_PILOT_MODEL) {
    if (!apiKey) throw new Error("RISKSHIELD_INTERPRETER_API_KEY 환경 변수가 필요합니다.");
    this.apiKey = apiKey;
    this.model = model;
  }

  static fromEnvironment(environment: ProviderEnvironment = process.env as ProviderEnvironment) {
    return new GoogleGenAiProvider(environment.RISKSHIELD_INTERPRETER_API_KEY ?? "");
  }

  async complete(request: Parameters<LiveProvider["complete"]>[0]): Promise<LiveProviderResult> {
    const endpoint = `${GOOGLE_GENAI_ENDPOINT}/models/${this.model}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
        systemInstruction: { parts: [{ text: `${request.systemPrompt}\n${gemmaFunctionInstruction(request.userPrompt)}` }] },
        tools: [{
          functionDeclarations: [{
            name: FUNCTION_NAME,
            description: "입력 문구의 광고 문맥 분석 결과를 RiskShield Interpreter 형식으로 제출한다.",
            parametersJsonSchema: asFunctionParametersJsonSchema(request.schema),
          }],
        }],
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [FUNCTION_NAME],
          },
        },
        generationConfig: {
          temperature: 0,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
        store: false,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new GoogleGenAiHttpError(
        response.status,
        parseRetryAfterSeconds(response.headers.get("retry-after")),
      );
    }
    const body = await response.json() as GenerateContentResponse;
    const functionCalls = (body.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.functionCall)
      .filter((call): call is NonNullable<typeof call> => Boolean(call));
    if (functionCalls.length !== 1
      || functionCalls[0].name !== FUNCTION_NAME
      || !functionCalls[0].args
      || typeof functionCalls[0].args !== "object"
      || Array.isArray(functionCalls[0].args)) {
      throw new Error("Google GenAI가 유효한 Interpreter 함수 인자를 반환하지 않았습니다.");
    }

    return {
      output: functionCalls[0].args,
      model: body.modelVersion ?? this.model,
      tokenUsage: {
        input: body.usageMetadata?.promptTokenCount ?? 0,
        output: body.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
