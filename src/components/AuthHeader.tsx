import { RunnerIcon } from "./icons";

export function AuthHeader({ title, tagline }: { title: string; tagline?: string }) {
  return (
    <div className="stack" style={{ alignItems: "center", textAlign: "center", gap: "var(--s2)" }}>
      <span className="brand-mark" style={{ width: 56, height: 56, borderRadius: 16 }}>
        <RunnerIcon />
      </span>
      <div style={{ fontWeight: 700, fontSize: "1.25rem" }}>workingRun</div>
      {tagline ? <p className="muted" style={{ margin: 0 }}>{tagline}</p> : null}
      <h1 style={{ marginTop: "var(--s4)" }}>{title}</h1>
    </div>
  );
}
