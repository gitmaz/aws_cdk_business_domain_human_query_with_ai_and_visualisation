import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, type AuthProviderProps } from "react-oidc-context";
import "./index.css";
import { AppLocal } from "./AppLocal.tsx";
import { AppOidc } from "./AppOidc.tsx";

const stage = (import.meta.env.VITE_APP_STAGE ?? "local").toLowerCase();
const isLocal = stage === "local";

function oidcProps(): AuthProviderProps {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY?.trim();
  const client_id = import.meta.env.VITE_OIDC_CLIENT_ID?.trim();
  const redirect =
    import.meta.env.VITE_OIDC_REDIRECT_URI?.trim() ||
    `${window.location.origin}${window.location.pathname}`;
  if (!authority || !client_id) {
    throw new Error(
      "For non-local stages set VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID (IAM Identity Center / OIDC app).",
    );
  }
  return {
    authority,
    client_id,
    redirect_uri: redirect,
    response_type: "code",
    scope: import.meta.env.VITE_OIDC_SCOPE?.trim() || "openid profile email",
    automaticSilentRenew: true,
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}

const app = isLocal ? <AppLocal /> : (
  <AuthProvider {...oidcProps()}>
    <AppOidc />
  </AuthProvider>
);

createRoot(document.getElementById("root")!).render(<StrictMode>{app}</StrictMode>);
