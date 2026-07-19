export function controlPlaneUnavailableResponse() {
  return Response.json(
    {
      error: "control_plane_unavailable",
      message: "이 기능은 현재 사용할 수 없습니다.",
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": "3600",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
