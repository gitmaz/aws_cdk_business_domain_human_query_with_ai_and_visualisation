import { useAuth } from "react-oidc-context";
import { HumanQueryForm } from "./HumanQueryForm";

export function AppOidc() {
  const auth = useAuth();
  const stage = import.meta.env.VITE_APP_STAGE ?? "dev";

  const authGate = !auth.isAuthenticated ? (
    <div className="hq-auth">
      <p className="hq-auth-text">Sign in with your organization SSO (OIDC) before calling the API.</p>
      <button type="button" className="hq-btn hq-btn-secondary" onClick={() => void auth.signinRedirect()}>
        Sign in
      </button>
    </div>
  ) : (
    <div className="hq-auth hq-auth-signedin">
      <span className="hq-auth-text">Signed in{auth.user?.profile?.email ? ` as ${String(auth.user.profile.email)}` : ""}.</span>
      <button type="button" className="hq-btn hq-btn-ghost" onClick={() => void auth.signoutRedirect()}>
        Sign out
      </button>
    </div>
  );

  const token = auth.user?.access_token;
  const canQuery = auth.isAuthenticated && !!token;

  return (
    <HumanQueryForm
      accessToken={canQuery ? token : undefined}
      authGate={authGate}
      stageLabel={stage}
      requireAuth
    />
  );
}
