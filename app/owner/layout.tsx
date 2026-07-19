import managementStylesheet from "../../styles/management.css?url";

export const dynamic = "force-dynamic";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <><link rel="stylesheet" href={managementStylesheet} />{children}</>;
}
