import { useEffect, useMemo, useState } from "react";
import { Topbar } from "./components/Topbar";
import { FiltersBar, type ChipKey } from "./components/FiltersBar";
import { CanvasPane } from "./components/CanvasPane";
import { Inspector } from "./components/Inspector";
import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type ExtToWebviewMessage,
} from "./lib/vscode";

const vscode = getVSCodeApi();

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

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  const [activeChip, setActiveChip] = useState<ChipKey>("functions");

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;
      if (msg.type === "activeFile") setActiveFile(msg.payload);
      if (msg.type === "selection") setSelection(msg.payload);
      if (msg.type === "analysisResult") setAnalysis(msg.payload);
    };

    window.addEventListener("message", onMessage);

    vscode.postMessage({ type: "requestActiveFile" });
    vscode.postMessage({ type: "requestSelection" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  const hasData = Boolean(analysis);

  const projectName = useMemo(() => {
    if (activeFile?.fileName) return activeFile.fileName;
    return "Active File";
  }, [activeFile?.fileName]);

  return (
    <div className="appRoot">
      <Topbar
        projectName={projectName}
        onRefresh={() => {
          vscode.postMessage({ type: "requestActiveFile" });
          vscode.postMessage({ type: "requestSelection" });
        }}
        onGenerate={() => {
          vscode.postMessage({ type: "analyzeActiveFile" });
        }}
      />

      <FiltersBar active={activeChip} onChange={setActiveChip} />

      {/* ✅ App.css에 이미 정의된 가로 레이아웃 컨테이너 */}
      <div className="main">
        <CanvasPane
          hasData={hasData}
          onGenerateFromActive={() => {
            vscode.postMessage({ type: "analyzeActiveFile" });
          }}
          onUseSelectionAsRoot={() => {
            vscode.postMessage({ type: "requestSelection" });
          }}
        />

        <Inspector
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          onRefreshActive={() => {
            vscode.postMessage({ type: "requestActiveFile" });
          }}
        />
      </div>
    </div>
  );
}
