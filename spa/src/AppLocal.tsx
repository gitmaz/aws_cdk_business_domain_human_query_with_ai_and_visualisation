import { HumanQueryForm } from "./HumanQueryForm";

export function AppLocal() {
  const stage = import.meta.env.VITE_APP_STAGE ?? "local";
  return (
    <HumanQueryForm
      accessToken={undefined}
      authGate={null}
      stageLabel={stage}
      requireAuth={false}
    />
  );
}
