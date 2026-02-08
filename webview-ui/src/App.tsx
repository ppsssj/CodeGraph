import { useEffect, useMemo, useState } from "react";
import { Topbar } from "./components/Topbar";
import { FiltersBar, type ChipKey } from "./components/FiltersBar";
import { CanvasPane } from "./components/CanvasPane";
import { Inspector } from "./components/Inspector";
import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type ExtToWebviewMessage,
  type GraphNode,
  type GraphPayload,
} from "./lib/vscode";
import "./styles/index.css";

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

function findNodeById(graph: GraphPayload | undefined, id: string | null) {
  if (!graph || !id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

function mergeGraph(
  prev: GraphPayload | undefined,
  next: GraphPayload | undefined,
): GraphPayload | undefined {
  if (!next) return prev;
  if (!prev) return next;

  const nodeById = new Map(prev.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) nodeById.set(n.id, n);

  const edgeById = new Map(prev.edges.map((e) => [e.id, e]));
  for (const e of next.edges) edgeById.set(e.id, e);

  return { nodes: [...nodeById.values()], edges: [...edgeById.values()] };
}

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  // Graph is merged over time (external expansions)
  const [graphState, setGraphState] = useState<GraphPayload | undefined>(
    undefined,
  );

  // Avoid re-expanding the same external file repeatedly
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(),
  );

  const [activeChip, setActiveChip] = useState<ChipKey>("functions");

  // Selected graph node id (Inspector binding)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;
      if (msg.type === "activeFile") setActiveFile(msg.payload);
      if (msg.type === "selection") setSelection(msg.payload);
      if (msg.type === "analysisResult") {
        setAnalysis(msg.payload);
        const g = msg.payload?.graph;
        if (g) setGraphState((prev) => mergeGraph(prev, g));
        if (!msg.payload) {
          setGraphState(undefined);
          setExpandedFiles(new Set());
        }
      }
    };

    window.addEventListener("message", onMessage);

    vscode.postMessage({ type: "requestActiveFile" });
    vscode.postMessage({ type: "requestSelection" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  const graph = graphState;
  const hasGraphData = Boolean(graph && graph.nodes.length > 0);

  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const projectName = activeFile?.fileName
    ? activeFile.fileName
    : "Active File";

  const resetGraph = () => {
    setGraphState(undefined);
    setExpandedFiles(new Set());
    setSelectedNodeId(null);
  };

  const expandExternalFile = (filePath: string) => {
    if (!filePath) return;
    if (expandedFiles.has(filePath)) return;

    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });

    vscode.postMessage({ type: "expandNode", filePath });
  };

  return (
    <div className="appRoot">
      <Topbar
        projectName={projectName}
        onRefresh={() => {
          vscode.postMessage({ type: "requestActiveFile" });
          vscode.postMessage({ type: "requestSelection" });
        }}
        onGenerate={() => {
          resetGraph();
          vscode.postMessage({ type: "analyzeActiveFile" });
        }}
      />

      <FiltersBar active={activeChip} onChange={setActiveChip} />

      <div className="main">
        <CanvasPane
          hasData={hasGraphData}
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
          onClearSelection={() => setSelectedNodeId(null)}
          onGenerateFromActive={() => {
            vscode.postMessage({ type: "analyzeActiveFile" });
          }}
          onUseSelectionAsRoot={() => {
            vscode.postMessage({ type: "requestSelection" });
          }}
          onExpandExternal={(filePath) => expandExternalFile(filePath)}
        />

        <Inspector
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          selectedNode={selectedNode}
          onRefreshActive={() => {
            vscode.postMessage({ type: "requestActiveFile" });
          }}
          onResetGraph={resetGraph}
          onExpandExternal={(filePath) => expandExternalFile(filePath)}
        />
      </div>
    </div>
  );
}
