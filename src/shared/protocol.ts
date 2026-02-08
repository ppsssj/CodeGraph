export type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile" } // backward-compatible (workspace-aware when possible)
  | { type: "analyzeWorkspace" } // explicit workspace-aware analysis
  | { type: "expandNode"; payload: { filePath: string } }; // analyze centered on another file

export type AnalysisCallV1 = { name: string; count: number };

export type AnalysisCallV2 = {
  calleeName: string;
  count: number;
  declFile: string | null;
  declRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  isExternal: boolean;
};

export type GraphNodeKind =
  | "file"
  | "function"
  | "method"
  | "class"
  | "external";
export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  signature?: string;
};

export type GraphEdgeKind = "calls" | "constructs" | "dataflow";
export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  label?: string;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type ExtToWebviewMessage =
  | {
      type: "activeFile";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        text: string;
        isUntitled: boolean;
      } | null;
    }
  | {
      type: "selection";
      payload: {
        uri: string;
        selectionText: string;
        start: { line: number; character: number };
        end: { line: number; character: number };
      } | null;
    }
  | {
      type: "analysisResult";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        stats: { chars: number; lines: number };
        imports: Array<{
          source: string;
          specifiers: string[];
          kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
        }>;
        exports: Array<{
          name: string;
          kind:
            | "function"
            | "class"
            | "type"
            | "interface"
            | "const"
            | "unknown";
        }>;
        // ✅ V1/V2 모두 수용 (Webview 쪽에서 구버전 호환 처리)
        calls: Array<AnalysisCallV1 | AnalysisCallV2>;
        // ✅ Graph payload (optional)
        graph?: GraphPayload;
        meta?: {
          mode: "single-file" | "workspace";
          rootFiles?: number;
          usedTsconfig?: boolean;
          projectRoot?: string;
        };
      } | null;
    };
