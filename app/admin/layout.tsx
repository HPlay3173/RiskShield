import { requirePageCapability } from "../../lib/auth/authorize";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("/admin", "candidate:read");
  return children;
}
