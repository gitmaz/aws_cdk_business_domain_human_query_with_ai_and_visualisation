import { useCallback, useState, type ReactNode } from "react";
import type { IntentResponse, VisualizeResponse } from "./api";
import { apiPost } from "./api";

type Props = {
  accessToken: string | undefined;
  authGate: ReactNode;
  stageLabel: string;
  /** When true, block API calls until `accessToken` is set (non-local / OIDC). */
  requireAuth: boolean;
};

export function HumanQueryForm({ accessToken, authGate, stageLabel, requireAuth }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [logsQuery, setLogsQuery] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setDashboardUrl(null);
    setLogsQuery(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Enter a question or observability request.");
      return;
    }
    if (requireAuth && !accessToken) {
      setError("Sign in first so the API receives your access token.");
      return;
    }
    setBusy(true);
    try {
      const intent = await apiPost<IntentResponse>("/intent", { message: trimmed }, accessToken);
      if (!intent.structuredIntent) {
        setError(intent.error ?? "Intent response missing structuredIntent.");
        return;
      }
      const viz = await apiPost<VisualizeResponse>(
        "/visualize",
        { structuredIntent: intent.structuredIntent },
        accessToken,
      );
      const url = viz.grafana?.dashboardUrl;
      if (!url) {
        setError(viz.error ?? "Visualize response missing grafana.dashboardUrl.");
        return;
      }
      setDashboardUrl(url);
      setLogsQuery(viz.query ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [accessToken, message, requireAuth]);

  return (
    <div className="hq-wrap">
      <header className="hq-header">
        <h1 className="hq-title">Human query → Grafana</h1>
        <p className="hq-sub">
          Stage: <strong>{stageLabel}</strong>
          {accessToken ? " · API calls use your OIDC access token." : " · Local: no SSO; API is open (CORS + anonymous Grafana)."}
        </p>
        {authGate}
      </header>

      <label className="hq-label" htmlFor="hq-message">
        Natural language
      </label>
      <textarea
        id="hq-message"
        className="hq-textarea"
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Example: Show warehouse inventory delays in the last 24 hours"
        disabled={busy || (requireAuth && !accessToken)}
      />

      <div className="hq-actions">
        <button
          type="button"
          className="hq-btn"
          onClick={() => void run()}
          disabled={busy || (requireAuth && !accessToken)}
        >
          {busy ? "Working…" : "Build Grafana link"}
        </button>
      </div>

      {error ? (
        <div className="hq-error" role="alert">
          {error}
        </div>
      ) : null}

      {dashboardUrl ? (
        <section className="hq-result" aria-live="polite">
          <h2 className="hq-h2">Grafana dashboard URL</h2>
          <p className="hq-hint">
            Opens in a new tab. The dashboard applies your Logs Insights query via the{" "}
            <code>dynamicQuery</code> variable.
          </p>
          {logsQuery ? (
            <details className="hq-details">
              <summary>Built Logs Insights query</summary>
              <pre className="hq-pre">{logsQuery}</pre>
            </details>
          ) : null}
          <a className="hq-link" href={dashboardUrl} target="_blank" rel="noopener noreferrer">
            Open in Grafana
          </a>
          <p className="hq-urlmono">{dashboardUrl}</p>
        </section>
      ) : null}
    </div>
  );
}
