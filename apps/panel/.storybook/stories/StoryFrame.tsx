import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { WorkspaceShell } from "../../src/components/workspace/WorkspaceShell";
import { user } from "./fixtures";

export function StoryFrame({
  view,
  children,
}: {
  view: "works" | "accounting" | "inventory";
  children: ReactNode;
}) {
  return (
    <>
      <WorkspaceShell
        user={user}
        view={view}
        projectCount={12}
        onNavigate={() => false}
      >
        <div className="storybook-demo">
          <FlaskConical size={17} />
          <span>
            Vista de ejemplo · Datos ficticios para revisar la interfaz
          </span>
        </div>
        {children}
      </WorkspaceShell>
      <div id="workspace-overlays" />
    </>
  );
}
