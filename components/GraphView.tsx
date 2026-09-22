import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RotateCcw, Maximize, Minimize, Flame, Search } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { CustomNode } from "./graph/CustomNode";
import { WaypointEdge } from "./graph/WaypointEdge";
import { LAYOUT_ALGORITHMS, type LayoutAlgorithm } from "./graph/layout";

const nodeTypes = {
  custom: CustomNode,
};
const edgeTypes = { waypoint: WaypointEdge };

import { useFactoryStore } from "../store/useFactoryStore";

function GraphControls() {
  const { activeFactoryId, resetFactoryLayout, showUtilityEdges, toggleUtilityEdges, factories, layoutAlgorithm, setLayoutAlgorithm } = useFactoryStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  const { fitView } = useReactFlow();

  // Jump to the first node whose item name matches; Enter cycles through matches
  const [matchIdx, setMatchIdx] = useState(0);
  const jump = () => {
    const nodes = factories.find((f) => f.id === activeFactoryId)?.nodes ?? [];
    const q = query.trim().toLowerCase();
    const hits = q ? nodes.filter((n) => String((n.data as { itemName?: string })?.itemName ?? "").toLowerCase().includes(q)) : [];
    if (!hits.length) return;
    const hit = hits[matchIdx % hits.length];
    setMatchIdx((i) => i + 1);
    fitView({ nodes: [{ id: hit.id }], duration: 300, maxZoom: 1.2 });
  };

  // Listen for fullscreen changes (user can exit via ESC key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);

      // Fit view when fullscreen state changes
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
      }, 100);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [fitView]);

  // Listen for window resize
  useEffect(() => {
    const handleResize = () => {
      fitView({ padding: 0.2, duration: 300 });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [fitView]);

  const toggleFullscreen = async () => {
    // Find the graph container (parent of this controls component)
    const graphContainer = document.querySelector('.graph-fullscreen-container');
    if (!graphContainer) return;

    try {
      if (!document.fullscreenElement) {
        await (graphContainer as HTMLElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
    }
  };

  return (
    <div className="absolute top-4 right-4 z-10 flex gap-2">
      <label className="flex items-center gap-1.5 bg-[var(--surface)] px-2.5 py-1.5 rounded-lg border border-[var(--border)] shadow-lg text-xs focus-within:border-[var(--accent-gold-dim)]">
        <Search size={13} className="text-[var(--text-muted)]" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setMatchIdx(0); }}
          onKeyDown={(e) => { if (e.key === "Enter") jump(); }}
          placeholder="Find item… ⏎"
          className="w-28 bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </label>
      <button
        onClick={toggleUtilityEdges}
        className={`flex items-center gap-2 bg-[var(--surface)] hover:bg-[var(--surface-elevated)] px-3 py-1.5 rounded-lg border shadow-lg text-xs font-bold transition-all ${showUtilityEdges ? "border-red-400/60 text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
        title="Show heat and fertilizer flows"
      >
        <Flame size={14} className={showUtilityEdges ? "text-red-400" : ""} />
        Heat/Fert
      </button>
      <button
        onClick={toggleFullscreen}
        className="flex items-center gap-2 bg-[var(--surface)] hover:bg-[var(--surface-elevated)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent-purple-dim)] shadow-lg text-xs font-bold transition-all hover:glow-purple-subtle"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? (
          <>
            <Minimize size={14} className="text-[var(--accent-purple)]" />
            Exit Fullscreen
          </>
        ) : (
          <>
            <Maximize size={14} className="text-[var(--accent-purple)]" />
            Fullscreen
          </>
        )}
      </button>
      <select
        value={layoutAlgorithm}
        onChange={(e) => setLayoutAlgorithm(e.target.value as LayoutAlgorithm)}
        title="Layout algorithm (ELK)"
        className="bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1.5 rounded-lg border border-[var(--border)] shadow-lg text-xs font-bold"
      >
        {LAYOUT_ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <button
        onClick={() => resetFactoryLayout(activeFactoryId!)}
        className="flex items-center gap-2 bg-[var(--surface)] hover:bg-[var(--surface-elevated)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent-gold-dim)] shadow-lg text-xs font-bold transition-all hover:glow-gold-subtle"
        title="Reset Layout"
      >
        <RotateCcw size={14} className="text-[var(--accent-gold)]" />
        Reset Layout
      </button>
    </div>
  );
}

export function GraphView() {
  const {
    factories,
    activeFactoryId,
    onNodesChange,
    onEdgesChange,
    onViewportChange,
    showUtilityEdges,
  } = useFactoryStore();

  const activeFactory = factories.find((f) => f.id === activeFactoryId);
  const [focus, setFocus] = useState<string | null>(null);

  // Click a node: everything upstream and downstream of it stays lit, the rest dims
  const chain = useMemo(() => {
    if (!focus || !activeFactory) return null;
    const up = new Map<string, string[]>(), down = new Map<string, string[]>();
    for (const e of activeFactory.edges) {
      if (e.data?.utility) continue;
      up.set(e.target, [...(up.get(e.target) ?? []), e.source]);
      down.set(e.source, [...(down.get(e.source) ?? []), e.target]);
    }
    const seen = new Set<string>([focus]);
    for (const next of [up, down]) {
      const stack = [focus];
      while (stack.length) for (const n of next.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    return seen;
  }, [focus, activeFactory]);

  // If no factory is active, we probably shouldn't render, but let's handle it gracefully or rely on parent
  if (!activeFactory) return null;

  const { nodes: rawNodes, edges: rawEdges, viewport: defaultViewport } = activeFactory;
  const dim = { opacity: 0.15 };
  const nodes = chain ? rawNodes.map((n) => (chain.has(n.id) ? n : { ...n, style: { ...n.style, ...dim } })) : rawNodes;
  const edges = rawEdges.map((e) => {
    const hidden = !showUtilityEdges && !!e.data?.utility;
    const faded = chain && !(chain.has(e.source) && chain.has(e.target));
    return hidden || faded ? { ...e, hidden, style: { ...e.style, ...(faded ? dim : {}) }, animated: !faded && e.animated } : e;
  });

  return (
    <div className="graph-fullscreen-container absolute inset-0 bg-[var(--background-deep)]/80">
      {/* Subtle arcane pattern overlay */}
      <div className="absolute inset-0 bg-arcane-pattern opacity-20 pointer-events-none"></div>

      <ReactFlow
        key={activeFactory.id}
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, n) => setFocus((f) => (f === n.id ? null : n.id))}
        onPaneClick={() => setFocus(null)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveEnd={(e, viewport) => onViewportChange?.(viewport)}
        defaultViewport={defaultViewport}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        style={{ width: "100%", height: "100%" }}
        minZoom={0.1}
        maxZoom={4}
      >
        <Background color="#352a4d" gap={24} size={1} />
        <Controls />
        <GraphControls />
      </ReactFlow>
    </div>
  );
}

