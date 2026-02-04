import "./../App.css";
import { Settings } from "lucide-react";
import type { ExtToWebviewMessage } from "../lib/vscode";
import { ActiveFileSnapshot } from "./ActiveFileSnapshot";
import { AnalysisPanel } from "./AnalysisPanel";

type ActiveFilePayload = Extract<
  ExtToWebviewMessage,
  { type: "activeFile" }
>["payload"];
type SelectionPayload = Extract<
  ExtToWebviewMessage,
  { type: "selection" }
>["payload"];
type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];

type Props = {
  activeFile: ActiveFilePayload;
  selection: SelectionPayload;
  analysis: AnalysisPayload;
  onRefreshActive: () => void;
};

export function Inspector({
  activeFile,
  selection,
  analysis,
  onRefreshActive,
}: Props) {
  return (
    <aside className="inspector">
      <div className="inspectorHeader">
        <div>
          <h1>Inspector</h1>
          <p>COMPONENT ANALYSIS</p>
        </div>
        <button className="iconBtn subtle" type="button" title="Settings">
          <Settings className="icon" />
        </button>
      </div>

      <div className="inspectorBody">
        <div className="inspectorPad">
          <ActiveFileSnapshot
            fileName={activeFile?.fileName}
            languageId={activeFile?.languageId}
            text={activeFile?.text}
            onRefresh={onRefreshActive}
          />

          <div className="panel">
            <div className="panelHeader">
              <span>SELECTION</span>
            </div>
            <div className="panelBody">
              <div className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
                {selection
                  ? `${selection.start.line + 1}:${selection.start.character} → ${selection.end.line + 1}:${
                      selection.end.character
                    }`
                  : "No selection"}
              </div>

              <pre
                className="mono"
                style={{
                  margin: 0,
                  maxHeight: 140,
                  overflow: "auto",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  whiteSpace: "pre",
                }}
              >
                {selection?.selectionText || ""}
              </pre>
            </div>
          </div>

          <AnalysisPanel analysis={analysis} />
        </div>
      </div>
    </aside>
  );
}
