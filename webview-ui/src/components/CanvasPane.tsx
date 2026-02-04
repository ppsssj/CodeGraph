import "./../App.css";
import { Crosshair, Network, Sigma, ZoomIn, ZoomOut } from "lucide-react";

type Props = {
  hasData: boolean;
  onGenerateFromActive: () => void; // analyze active file
  onUseSelectionAsRoot: () => void; // (지금은 selection 요청만)
};

export function CanvasPane({
  hasData,
  onGenerateFromActive,
  onUseSelectionAsRoot,
}: Props) {
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

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 8,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
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

      <div className="canvasControls">
        <div className="controlsCard">
          <button className="controlBtn" type="button" title="Zoom in">
            <ZoomIn className="icon" />
          </button>
          <div className="controlSep" />
          <button className="controlBtn" type="button" title="Zoom out">
            <ZoomOut className="icon" />
          </button>
          <div className="controlSep" />
          <button className="controlBtn" type="button" title="Center">
            <Crosshair className="icon" />
          </button>
        </div>
      </div>
    </section>
  );
}
