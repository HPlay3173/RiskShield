import { controlApi } from "../../../../lib/auth/control-api";

export function GET(request: Request) {
  return controlApi(request, "candidate:read");
}

export function POST(request: Request) {
  return controlApi(request, "candidate:decide", true);
}

export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
