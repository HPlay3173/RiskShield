import type { LiveProvider, LiveProviderResult } from "./interpreter.ts";

interface ProviderEnvironment {
  RISKSHIELD_INTERPRETER_ENDPOINT?: string;
  RISKSHIELD_INTERPRETER_API_KEY?: string;
  RISKSHIELD_INTERPRETER_MODEL?: string;
  RISKSHIELD_INTERPRETER_INPUT_USD_PER_MILLION?: string;
  RISKSHIELD_INTERPRETER_OUTPUT_USD_PER_MILLION?: string;
}

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatibleProvider implements LiveProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly inputUsdPerMillion: number;
  private readonly outputUsdPerMillion: number;

  constructor(
    endpoint: string,
    apiKey: string,
    model: string,
    inputUsdPerMillion = 0,
    outputUsdPerMillion = 0,
  ) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.inputUsdPerMillion = inputUsdPerMillion;
    this.outputUsdPerMillion = outputUsdPerMillion;
    this.id = `openai-compatible:${new URL(endpoint).host}`;
  }

  static fromEnvironment(environment: ProviderEnvironment = process.env as ProviderEnvironment) {
    const endpoint = environment.RISKSHIELD_INTERPRETER_ENDPOINT;
    const apiKey = environment.RISKSHIELD_INTERPRETER_API_KEY;
    const model = environment.RISKSHIELD_INTERPRETER_MODEL;
    if (!endpoint || !apiKey || !model) {
      throw new Error(
        "LiveInterpreter에는 RISKSHIELD_INTERPRETER_ENDPOINT, RISKSHIELD_INTERPRETER_API_KEY, RISKSHIELD_INTERPRETER_MODEL이 필요합니다.",
      );
    }
    return new OpenAiCompatibleProvider(
      endpoint,
      apiKey,
      model,
      Number(environment.RISKSHIELD_INTERPRETER_INPUT_USD_PER_MILLION ?? 0),
      Number(environment.RISKSHIELD_INTERPRETER_OUTPUT_USD_PER_MILLION ?? 0),
    );
  }

  async complete(request: Parameters<LiveProvider["complete"]>[0]): Promise<LiveProviderResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "riskshield_interpreter",
            strict: true,
            schema: request.schema,
          },
        },
      }),
      signal: request.signal,
    });
    if (!response.ok) {
      throw new Error(`Live provider HTTP ${response.status}`);
    }
    const body = await response.json() as ChatCompletionPayload;
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Live provider가 JSON content를 반환하지 않았습니다.");
    const input = body.usage?.prompt_tokens ?? 0;
    const output = body.usage?.completion_tokens ?? 0;
    return {
      output: JSON.parse(content) as unknown,
      model: body.model ?? this.model,
      tokenUsage: { input, output },
      estimatedCost: (input * this.inputUsdPerMillion + output * this.outputUsdPerMillion) / 1_000_000,
    };
  }
}
