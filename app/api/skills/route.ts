const RETIRED_MESSAGE =
  "이 endpoint는 폐기되었습니다. 스킬 데이터는 서버 내부 분석 경로에서만 사용됩니다.";

function retiredResponse() {
  return Response.json(
    { error: "endpoint_retired", message: RETIRED_MESSAGE },
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function GET() {
  return retiredResponse();
}

export function HEAD() {
  return retiredResponse();
}

export function POST() {
  return retiredResponse();
}

export function PUT() {
  return retiredResponse();
}

export function DELETE() {
  return retiredResponse();
}
