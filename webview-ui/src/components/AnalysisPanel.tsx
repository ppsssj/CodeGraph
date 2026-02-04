import "./../App.css";
import { ArrowDownLeft, ArrowUpRight, Sigma } from "lucide-react";
import type { ExtToWebviewMessage } from "../lib/vscode";

type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];

type Props = {
  analysis: AnalysisPayload;
};

export function AnalysisPanel({ analysis }: Props) {
  if (!analysis) {
    return (
      <div className="panel">
        <div className="panelHeader">
          <span>ANALYSIS</span>
        </div>
        <div className="panelBody">
          <div className="mutedText">
            No analysis result yet. Click Generate.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panelHeader">
        <span>ANALYSIS</span>
        <span className="mono" style={{ opacity: 0.75 }}>
          {analysis.stats.lines} lines · {analysis.stats.chars} chars
        </span>
      </div>

      <div className="panelBody" style={{ gap: 14 }}>
        {/* Imports */}
        <Section
          title={`Imports (${analysis.imports.length})`}
          icon={<ArrowDownLeft className="icon" />}
        >
          {analysis.imports.length === 0 ? (
            <div className="mutedText">No imports detected.</div>
          ) : (
            <div className="kvList">
              {analysis.imports.slice(0, 30).map((imp, idx) => (
                <div className="kvRow" key={`${imp.source}-${idx}`}>
                  <div className="kvKey mono">{imp.source}</div>
                  <div className="kvVal mono">
                    {imp.kind === "side-effect"
                      ? "(side-effect)"
                      : imp.specifiers.length
                        ? imp.specifiers.join(", ")
                        : "(none)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Exports */}
        <Section
          title={`Exports (${analysis.exports.length})`}
          icon={<ArrowUpRight className="icon" />}
        >
          {analysis.exports.length === 0 ? (
            <div className="mutedText">No exports detected.</div>
          ) : (
            <div className="tagGrid">
              {analysis.exports.slice(0, 40).map((ex, idx) => (
                <span className="tag" key={`${ex.name}-${idx}`}>
                  <span className="tagKind">{ex.kind}</span>
                  <span className="tagName mono">{ex.name}</span>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Calls */}
        <Section
          title={`Calls (top ${Math.min(analysis.calls.length, 20)})`}
          icon={<Sigma className="icon" />}
        >
          {analysis.calls.length === 0 ? (
            <div className="mutedText">No calls detected.</div>
          ) : (
            <div className="kvList">
              {analysis.calls.slice(0, 20).map((c) => (
                <div className="kvRow" key={c.name}>
                  <div className="kvKey mono">{c.name}()</div>
                  <div className="kvVal mono">{c.count}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sectionTitle">
        <span className="sectionTitleLeft">
          {icon}
          <span>{title}</span>
        </span>
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
