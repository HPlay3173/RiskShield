import { requirePageCapability } from "../../lib/auth/authorize";

export const dynamic = "force-dynamic";

export default async function DevLayout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("/dev", "dataset:manage");
  return children;
}
