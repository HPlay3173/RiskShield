import type { Capability, CurrentPrincipal } from "./current-principal";

export function can(principal: CurrentPrincipal, capability: Capability) {
  return principal.capabilities.has(capability);
}
