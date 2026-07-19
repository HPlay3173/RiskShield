import { requirePageCapability } from "../../lib/auth/authorize";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("/owner/access", "principal:manage");
  return children;
}
