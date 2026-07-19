import { headers } from "next/headers";
import type { AreaPrincipal } from "../components/shell/AreaShells";
import { requirePageCapability } from "./auth/authorize";
import type { Capability, CurrentPrincipal, Role } from "./auth/current-principal";
import { createRepositoryServices } from "./repositories";

const ROLE_LABELS: Record<Role, string> = {
  reviewer: "Reviewer",
  developer: "Developer",
  owner: "Owner",
};

function displayName(principal: CurrentPrincipal) {
  if (principal.authSource === "development_fixture") return "Local development owner";
  if (principal.authSource === "access_code") return "Access code owner";
  return principal.normalizedEmail.split("@", 1)[0] || "RiskShield user";
}

export function principalPresentation(principal: CurrentPrincipal): AreaPrincipal {
  return {
    displayName: displayName(principal),
    secondaryText: principal.normalizedEmail,
    roleLabel: ROLE_LABELS[principal.role],
    developmentFixture: principal.authSource === "development_fixture",
  };
}

export async function protectedProductPage(returnTo: string, capability: Capability) {
  const principal = await requirePageCapability(returnTo, capability);
  const requestHeaders = await headers();
  const repositories = await createRepositoryServices({ host: requestHeaders.get("host") });
  return {
    principal,
    presentation: principalPresentation(principal),
    repositories,
  };
}
