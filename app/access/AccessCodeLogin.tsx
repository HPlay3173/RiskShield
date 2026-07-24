"use client";

import { FormEvent, useState } from "react";
import { Pressable } from "../../components/interaction/Pressable";

function returnPath() {
  const value = new URLSearchParams(window.location.search).get("return_to");
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/manage";
  return value;
}

export function AccessCodeLogin() {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/access-code", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, returnTo: returnPath() }),
      });
      const payload = await response.json().catch(() => null) as { returnTo?: string } | null;
      if (!response.ok) {
        setMessage(response.status === 503
          ? "운영 access code가 아직 설정되지 않았습니다."
          : "코드를 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      window.location.assign(payload?.returnTo || "/manage");
    } catch {
      setMessage("로그인 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="accessCodeForm" onSubmit={submit}>
      <label htmlFor="riskshield-access-code">비밀코드</label>
      <input
        id="riskshield-access-code"
        name="access-code"
        type="password"
        autoComplete="current-password"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        disabled={submitting}
        required
        autoFocus
      />
      <Pressable className="primaryButton" type="submit" disabled={!code || submitting}>
        {submitting ? "확인 중…" : "관리 화면 열기"}
      </Pressable>
      <p className="accessCodeStatus" role="status" aria-live="polite">{message}</p>
    </form>
  );
}
