import { useEffect, useMemo, useState } from "react";
import "./App.css";

import { FiltersBar, type ChipKey } from "./components/FiltersBar";
import { Topbar } from "./components/Topbar";
import { CanvasPane } from "./components/CanvasPane";
import { Inspector } from "./components/Inspector";

import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type ExtToWebviewMessage,
  type VSCodeApi,
} from "./lib/vscode";

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
  const vscode: VSCodeApi = useMemo(() => getVSCodeApi(), []);

  const [active, setActive] = useState<ChipKey>("functions");
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  const requestActiveFile = () =>
    vscode.postMessage({ type: "requestActiveFile" });
  const requestSelection = () =>
    vscode.postMessage({ type: "requestSelection" });

  const analyzeActiveFile = () => {
    // 최신 텍스트 확보 + 분석 실행(순서 중요 X, extension이 lastTextEditor 기반이라 안정)
    requestActiveFile();
    vscode.postMessage({ type: "analyzeActiveFile" });
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const msg = event.data;
      if (!isExtToWebviewMessage(msg)) return;

      if (msg.type === "activeFile") setActiveFile(msg.payload ?? null);
      if (msg.type === "selection") setSelection(msg.payload ?? null);
      if (msg.type === "analysisResult") setAnalysis(msg.payload ?? null);
    };

    window.addEventListener("message", onMessage);

    // 초기 동기화
    requestActiveFile();
    requestSelection();

    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="appRoot">
      <Topbar
        projectName="Workspace"
        onRefresh={requestActiveFile}
        onGenerate={analyzeActiveFile}
      />

      <FiltersBar active={active} onChange={setActive} />

      <main className="main">
        <CanvasPane
          hasData={false}
          onGenerateFromActive={analyzeActiveFile}
          onUseSelectionAsRoot={requestSelection}
        />
        <Inspector
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          onRefreshActive={requestActiveFile}
        />
      </main>
    </div>
  );
}
