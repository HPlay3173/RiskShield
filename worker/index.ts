/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { RESPONSE_SECURITY_HEADERS } from "../lib/security-headers";
import { runDueCollectors } from "../lib/collectors/runner";
import { runDuePublicFeedbackIntakes } from "../lib/public-feedback/runner";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RISKSHIELD_X_BEARER_TOKEN?: string;
  RISKSHIELD_THREADS_ACCESS_TOKEN?: string;
  RISKSHIELD_INTERPRETER_API_KEY?: string;
  RISKSHIELD_YOUTUBE_API_KEY?: string;
  RISKSHIELD_COLLECTOR_HASH_KEY?: string;
  RISKSHIELD_SESSION_SIGNING_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function withSecurityHeaders(response: Response) {
  try {
    for (const [name, value] of Object.entries(RESPONSE_SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(RESPONSE_SECURITY_HEADERS)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    const response = withSecurityHeaders(await handler.fetch(request, env, ctx));
    if (request.method === "POST" && url.pathname === "/api/analyze/candidate" && response.status === 202) {
      ctx.waitUntil(runDuePublicFeedbackIntakes(env));
    }
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      runDueCollectors(env),
      runDuePublicFeedbackIntakes(env),
    ]));
  },
};

export default worker;
