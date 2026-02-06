import "./../App.css";
import "reactflow/dist/style.css";

import { useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  ReactFlowProvider,
  MarkerType,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";

import { Crosshair, Network, Sigma, ZoomIn, ZoomOut } from "lucide-react";
import type { GraphNode, GraphPayload } from "../lib/vscode";

type Props = {
  hasData: boolean;

  // analysisResult.payload.graph
  graph?: GraphPayload;

  // selection bridge to Inspector
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;

  onGenerateFromActive: () => void;
  onUseSelectionAsRoot: () => void;
};

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function nodeTitle(n: GraphNode) {
  if (n.kind === "class") return `class ${n.name}`;
  if (n.kind === "function") return `${n.name}()`;
  if (n.kind === "method") return `${n.name}()`;
  return n.name;
}

// Minimal deterministic layout (no deps)
function buildLayout(nodes: GraphNode[]) {
  const colW = 260;
  const rowH = 140;
  const cols = Math.max(1, Math.floor(Math.sqrt(nodes.length)));

  return nodes.map((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { id: n.id, position: { x: col * colW, y: row * rowH } };
  });
}

/** Custom node so we always render title/subtitle (default node expects data.label). */
function CodeNode({ data }: { data: { title: string; subtitle: string } }) {
  return (
    <div className="cgNode">
      <div className="cgNodeTitle">{data.title}</div>
      <div className="cgNodeSub">{data.subtitle}</div>
    </div>
  );
}

const nodeTypes = { code: CodeNode };

function toReactFlowNodes(graph?: GraphPayload): Node[] {
  if (!graph) return [];
  const layout = buildLayout(graph.nodes);
  const posById = new Map(layout.map((p) => [p.id, p.position]));

  return graph.nodes.map((n) => {
    const pos = posById.get(n.id) ?? { x: 0, y: 0 };
    const subtitle = `${n.kind} · ${shortFile(n.file)}:${n.range.start.line + 1}`;

    return {
      id: n.id,
      position: pos,
      type: "code",
      data: { title: nodeTitle(n), subtitle },
    } satisfies Node;
  });
}

function toReactFlowEdges(graph?: GraphPayload): Edge[] {
  if (!graph) return [];
  return graph.edges.map((e) => {
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      style: { strokeWidth: 2, stroke: "rgba(255,255,255,0.75)" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    } satisfies Edge;
  });
}

function CanvasFlow({
  hasData,
  graph,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onGenerateFromActive,
  onUseSelectionAsRoot,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const rfNodes = useMemo(() => toReactFlowNodes(graph), [graph]);
  const rfEdges = useMemo(() => toReactFlowEdges(graph), [graph]);

  const onZoomIn = () => rfRef.current?.zoomIn?.();
  const onZoomOut = () => rfRef.current?.zoomOut?.();
  const onCenter = () => {
    const inst = rfRef.current;
    if (!inst) return;

    if (selectedNodeId) {
      const n = inst.getNode(selectedNodeId);
      if (n) {
        inst.setCenter(n.position.x + 80, n.position.y + 40, {
          zoom: 1.1,
          duration: 200,
        });
        return;
      }
    }

    inst.fitView({ padding: 0.2, duration: 250 });
  };

  return (
    <section className="canvas">
      <div className="canvasGrid" />

      {!hasData ? (
        <div className="emptyState">
          <div className="emptyBadge">
            <Network className="icon emptyBadgeIcon" />
          </div>

          <div className="emptyText">
            <h3>No graph data generated</h3>
            <p>
              Click Generate to analyze the active file and build initial graph
              data.
            </p>
          </div>

          <div className="emptyActions">
            <button
              className="ctaBtn"
              type="button"
              onClick={onGenerateFromActive}
            >
              <Network className="icon ctaIcon" />
              <span>Generate from Active File</span>
            </button>

            <button
              className="ctaBtn"
              type="button"
              onClick={onUseSelectionAsRoot}
            >
              <Sigma className="icon ctaIcon" />
              <span>Use Selection as Root</span>
            </button>
          </div>
        </div>
      ) : null}

      {hasData ? (
        <div className="canvasFlow">
          <ReactFlow
            nodeTypes={nodeTypes}
            nodes={rfNodes}
            edges={rfEdges}
            onInit={(inst) => {
              rfRef.current = inst;
              inst.fitView({ padding: 0.25, duration: 0 });
            }}
            onPaneClick={() => onClearSelection()}
            onNodeClick={(_, node) => onSelectNode(node.id)}
            fitView
          >
            <Background />
          </ReactFlow>
        </div>
      ) : null}

      <div className="canvasControls">
        <div className="controlsCard">
          <button
            className="controlBtn"
            type="button"
            title="Zoom in"
            onClick={onZoomIn}
            disabled={!hasData}
          >
            <ZoomIn className="icon" />
          </button>
          <div className="controlSep" />
          <button
            className="controlBtn"
            type="button"
            title="Zoom out"
            onClick={onZoomOut}
            disabled={!hasData}
          >
            <ZoomOut className="icon" />
          </button>
          <div className="controlSep" />
          <button
            className="controlBtn"
            type="button"
            title="Center"
            onClick={onCenter}
            disabled={!hasData}
          >
            <Crosshair className="icon" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function CanvasPane(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
}
