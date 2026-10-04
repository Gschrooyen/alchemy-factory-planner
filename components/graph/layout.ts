import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { Edge, Node, Position } from "@xyflow/react";
import { ProductionNode } from "../../engine/types";

const nodeWidth = 250;
// ELK runs in a web worker; outside a browser (tests) there is none, so layout falls back to a plain grid
const elk = typeof window !== "undefined"
    ? new ELK({ workerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)) })
    : null;

type InputItem = { item: string; kind?: string };
const handleId = (i: InputItem) => (i.kind === "fuel" ? `fuel:${i.item}` : i.item);

/** Estimated node height: header block plus one 18px row per input (mirrors CustomNode). */
export const estimateHeight = (data: ProductionNode) => headerHeight(data) + inputsHeight(data);
// Calibrated against rendered CustomNode heights (raw 63, nursery 183, cauldron with heat 264)
const headerHeight = (data: ProductionNode) => {
    let h = 64;
    if (data.deviceCount > 0) h += 40;
    if (data.heatConsumption > 0) h += 30;
    if (data.surplus && data.surplus > 0.01) h += 32;
    h += (data.byproducts ?? []).filter((bp) => bp.recycled).length * 22;
    return h;
};
const inputsHeight = (data: ProductionNode) => {
    const inputs = (data as { inputItems?: InputItem[] }).inputItems || [];
    return inputs.length ? 8 + inputs.length * 18 + (inputs.some((i) => i.kind === "fuel") ? 18 : 0) : 0;
};
/** y of each input handle within the node, in the order CustomNode renders them (products, then heat). */
const inputPortYs = (data: ProductionNode) => {
    const inputs = (data as { inputItems?: InputItem[] }).inputItems || [];
    const products = inputs.filter((i) => i.kind !== "fuel"), fuels = inputs.filter((i) => i.kind === "fuel");
    const ys = new Map<string, number>();
    let y = headerHeight(data) + 8 + 9;
    for (const i of products) { ys.set(handleId(i), y); y += 18; }
    y += 18; // heat section header
    for (const i of fuels) { ys.set(handleId(i), y); y += 18; }
    return ys;
};

/**
 * ELK layered layout, left to right, with orthogonal edge routing and proper crossing minimisation.
 * Heat/fertilizer edges are kept out of the layout (they fan out from one source to every machine).
 * Each edge gets its ELK bend points as data.route; WaypointEdge draws them and re-routes live when a
 * node is dragged.
 */
export type LayoutAlgorithm = "layered" | "layered-compact" | "mrtree" | "stress" | "force";
export const LAYOUT_ALGORITHMS: { id: LayoutAlgorithm; label: string }[] = [
    { id: "layered", label: "Layered" },
    { id: "layered-compact", label: "Layered · compact" },
    { id: "mrtree", label: "Tree" },
    { id: "stress", label: "Stress" },
    { id: "force", label: "Force" },
];
const ALGORITHM_OPTIONS: Record<LayoutAlgorithm, Record<string, string>> = {
    layered: {
        "elk.algorithm": "layered",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": "140",
        "elk.spacing.nodeNode": "56",
        "elk.layered.crossingMinimization.thoroughness": "30",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.portConstraints": "FIXED_POS",
    },
    "layered-compact": {
        "elk.algorithm": "layered",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.spacing.nodeNode": "30",
        "elk.layered.crossingMinimization.thoroughness": "30",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        "elk.portConstraints": "FIXED_POS",
    },
    mrtree: { "elk.algorithm": "mrtree", "elk.spacing.nodeNode": "60" },
    stress: { "elk.algorithm": "stress", "elk.stress.desiredEdgeLength": "320", "elk.spacing.nodeNode": "60" },
    force: { "elk.algorithm": "force", "elk.force.repulsivePower": "2", "elk.spacing.nodeNode": "80" },
};

export const getLayoutedElements = async (nodes: Node[], edges: Edge[], algorithm: LayoutAlgorithm = "layered"): Promise<{ nodes: Node[]; edges: Edge[] }> => {
    const layoutEdges = edges.filter((e) => !e.data?.utility);
    const orthogonal = algorithm.startsWith("layered");
    const heights = new Map(nodes.map((n) => [n.id, estimateHeight(n.data as unknown as ProductionNode)]));

    const graph: ElkNode = {
        id: "root",
        layoutOptions: {
            "elk.direction": "RIGHT",
            "elk.layered.spacing.edgeNodeBetweenLayers": "30",
            "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
            "elk.spacing.edgeNode": "24",
            "elk.spacing.edgeEdge": "14",
            "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
            ...ALGORITHM_OPTIONS[algorithm],
        },
        // Ports (one per input row) only make sense for the layered router; the others take plain node edges
        children: nodes.map((n) => {
            const data = n.data as unknown as ProductionNode;
            const height = heights.get(n.id)!;
            if (!orthogonal) return { id: n.id, width: nodeWidth, height };
            const ports = [{ id: `${n.id}::out`, x: nodeWidth, y: height / 2, width: 1, height: 1 }];
            inputPortYs(data).forEach((y, hid) => ports.push({ id: `${n.id}::${hid}`, x: 0, y, width: 1, height: 1 }));
            ports.push({ id: `${n.id}::in`, x: 0, y: height / 2, width: 1, height: 1 });
            return { id: n.id, width: nodeWidth, height, ports, layoutOptions: { "elk.portConstraints": ALGORITHM_OPTIONS[algorithm]["elk.portConstraints"] ?? "FREE" } };
        }),
        edges: layoutEdges.map((e): ElkExtendedEdge => ({
            id: e.id,
            sources: [orthogonal ? `${e.source}::out` : e.source],
            targets: [orthogonal ? `${e.target}::${e.targetHandle ?? "in"}` : e.target],
        })),
    };

    const grid = () => ({
        nodes: nodes.map((node, i) => ({ ...node, position: { x: (i % 6) * (nodeWidth + 40), y: Math.floor(i / 6) * 260 }, style: { width: nodeWidth } })),
        edges,
    });
    if (!elk) return grid();
    let laid: ElkNode;
    try {
        laid = await elk.layout(graph);
    } catch (err) {
        console.error("[layout] ELK failed, falling back to a grid:", err);
        return grid();
    }
    const pos = new Map((laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
    const routes = new Map<string, { x: number; y: number }[]>();
    for (const e of laid.edges ?? []) {
        const sec = e.sections?.[0];
        if (sec) routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
    }

    const newNodes = nodes.map((node) => ({
        ...node,
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        position: pos.get(node.id) ?? { x: 0, y: 0 },
        style: { width: nodeWidth },
    }));
    const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
    // Only the layered algorithms route orthogonally; the others get React Flow's smoothstep edges
    const newEdges = edges.map((edge) => {
        const route = orthogonal ? routes.get(edge.id) : undefined;
        if (route) return { ...edge, type: "waypoint", data: { ...edge.data, route, layout: { source: at(edge.source), target: at(edge.target) } } };
        // Heat/fertilizer edges stay out of the layout; WaypointEdge routes them live around the nodes
        if (edge.data?.utility) return { ...edge, type: "waypoint", data: { ...edge.data, route: undefined } };
        return edge;
    });
    return { nodes: newNodes, edges: newEdges };
};
