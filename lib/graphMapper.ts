
import { Edge, MarkerType, Node } from "@xyflow/react";
import { ProductionNode } from "../engine/types";
import { getLayoutedElements, type LayoutAlgorithm } from "../components/graph/layout";
import { isLiquid } from "../engine/item-utils";

/**
 * Transforms ProductionNode trees into ReactFlow Nodes and Edges,
 * applies the Dagre layout, and respects saved positions.
 */
export interface GraphInputItem {
    item: string;
    kind?: "fuel" | "fertilizer";
}

/** Handle id for an input row; fuel rows get their own so heat edges never share a product row. */
export function inputHandleId(i: GraphInputItem): string {
    return i.kind === "fuel" ? `fuel:${i.item}` : i.item;
}

export async function generateGraph(
    rootNodes: ProductionNode[],
    savedPositions: Record<string, { x: number; y: number }> = {},
    algorithm: LayoutAlgorithm = "layered"
): Promise<{ nodes: Node[]; edges: Edge[] }> {
    if (rootNodes.length === 0) return { nodes: [], edges: [] };

    // ----------------------------------------------------
    // Merging Algorithm (Consolidate duplicate items)
    // ----------------------------------------------------
    // Map: NodeKey -> MergedNodeData
    const mergedNodes = new Map<string, ProductionNode>();
    // Map: EdgeKey -> Accumulated Rate
    const edgeRates = new Map<string, number>();

    // Track nodes currently being traversed to detect cycles
    const visiting = new Set<string>();

    // Track visited node objects globally to prevent double-counting
    // Same object appearing in multiple paths should only be counted once
    const visitedObjects = new WeakSet<ProductionNode>();

    // Track which consumption reference keys have had their inputs traversed
    // We accumulate rates but only traverse inputs once per key
    const traversedConsumptionKeys = new Set<string>();
    const edgeItems = new Map<string, string>(); // edgeKey -> item flowing along it
    const edgeKinds = new Map<string, "fuel" | "fertilizer" | undefined>(); // edgeKey -> heat / fertilizer / product

    function traverse(node: ProductionNode, parentName?: string, parent?: ProductionNode) {
        // Use explicit ID if available to prevent merging of Source vs Production nodes
        const key = node.id || node.itemName;

        // DEBUG: Log when processing plank nodes
        if (node.itemName === "Plank" || node.itemName.toLowerCase().includes("plank")) {
            console.log("[GraphMapper] Processing Plank node:", {
                key,
                rate: node.rate,
                deviceCount: node.deviceCount,
                isConsumptionReference: node.isConsumptionReference,
                parentName,
                hasInputs: node.inputs.length,
            });
        }

        // For consumption references: record edge with consumption rate, then traverse inputs
        // Check BEFORE cycle detection - consumption refs should always record edges
        if (node.isConsumptionReference) {
            // Always record the edge for this consumption reference
            if (parentName) {
                // Fuel edges get their own key: the same source can feed a node as product AND as heat
                const edgeKey = `${key}___${parentName}___${node.inputKind ?? ""}`;
                const currentRate = edgeRates.get(edgeKey) || 0;
                edgeRates.set(edgeKey, currentRate + node.rate);
                edgeItems.set(edgeKey, node.itemName);
                edgeKinds.set(edgeKey, node.inputKind);
            }

            // Traverse inputs to show production chain (including circular dependencies)
            // Only traverse inputs once per key to avoid duplicate traversals
            if (!traversedConsumptionKeys.has(key)) {
                traversedConsumptionKeys.add(key);
                // The reference already recorded the edge to parent; traverse the real source
                // without a parent so it doesn't record a second (gross-rate) edge.
                node.inputs.forEach((input) => traverse(input));
            }
            return;
        }

        // Cycle detection: if we're already visiting this node in current path, stop
        if (visiting.has(key)) {
            return;
        }

        // Record Relationship & Rate for production nodes (skip if already traversed as consumption ref)
        if (parentName && !traversedConsumptionKeys.has(key)) {
            const edgeKey = `${key}___${parentName}___`;
            const currentRate = edgeRates.get(edgeKey) || 0;
            // Produced inputs share one node object; the consumer records how much IT takes
            edgeRates.set(edgeKey, currentRate + (parent?.inputRates?.[node.itemName] ?? node.rate));
            edgeItems.set(edgeKey, node.itemName);
            edgeKinds.set(edgeKey, node.inputKind);
        }

        // Check if we've already processed this exact object
        // If so, just record the edge but don't re-traverse or add to totals
        if (visitedObjects.has(node)) {
            // Already processed this node object, skip to avoid double-counting
            return;
        }
        visitedObjects.add(node);

        // Update or Create (for non-consumption references)
        if (mergedNodes.has(key)) {
            const existing = mergedNodes.get(key)!;
            existing.rate += node.rate;
            existing.deviceCount += node.deviceCount;
            existing.heatConsumption += node.heatConsumption;
            existing.suppliedRate = (existing.suppliedRate || 0) + (node.suppliedRate || 0);
            node.byproducts.forEach((bp) => {
                const match = existing.byproducts.find((b) => b.itemName === bp.itemName);
                if (match) {
                    match.rate += bp.rate;
                    match.remaining = (match.remaining ?? match.rate) + (bp.remaining ?? bp.rate);
                } else existing.byproducts.push({ ...bp });
            });
            // Recalculate saturation based on total rate
            existing.isBeltSaturated = !isLiquid(existing.itemName) && existing.rate > (existing.beltLimit || 60) * (1 + 1e-6);

            // DEBUG: Log accumulation
            if (key.toLowerCase().includes("plank") || key.toLowerCase().includes("woodboard")) {
                console.log("[GraphMapper] Accumulating node:", key, "old:", existing.rate - node.rate, "adding:", node.rate, "new total:", existing.rate);
            }
        } else {
            mergedNodes.set(key, { ...node, inputs: [], byproducts: node.byproducts.map((bp) => ({ ...bp })) });
        }

        // Mark as visiting, recurse, then unmark
        visiting.add(key);
        node.inputs.forEach((input) => traverse(input, key, node));
        visiting.delete(key);
    }

    rootNodes.forEach((root) => traverse(root));

    // Calculate consumption for each item (how much is being consumed internally)
    // Skip consumption references - they're just edges showing fuel/fertilizer flow
    const consumption = new Map<string, number>();
    mergedNodes.forEach((node, key) => {
        node.inputs?.forEach((input) => {
            // Skip consumption references - they don't represent actual production nodes
            if (input.isConsumptionReference) return;

            // Key by ITEM NAME, not node ID (input.id can be node ID like "woodboard-prod-wood-board")
            const inputItemName = input.itemName;
            const current = consumption.get(inputItemName) || 0;
            consumption.set(inputItemName, current + (input.rate || 0));
        });
    });

    // DEBUG: Log consumption
    consumption.forEach((rate, key) => {
        if (key.toLowerCase().includes("plank") || key.toLowerCase().includes("woodboard")) {
            console.log("[GraphMapper] Internal consumption of", key, ":", rate, "/m");
        }
    });

    // Create React Flow Nodes (Production Network)
    // Per node: distinct items flowing in (one target handle each, so edges land on separate rows)
    const inputItemsByNode = new Map<string, GraphInputItem[]>();
    edgeItems.forEach((item, edgeKey) => {
        const target = edgeKey.split("___")[1];
        const list = inputItemsByNode.get(target) || [];
        const kind = edgeKinds.get(edgeKey);
        // Same item can be both product input and fuel (Plank -> Charcoal in a crucible): separate rows
        if (!list.some((i) => i.item === item && i.kind === kind)) list.push({ item, kind });
        inputItemsByNode.set(target, list);
    });

    const rfNodes: Node[] = Array.from(mergedNodes.values()).map((n) => {
        const nodeKey = n.id || n.itemName;

        // Only calculate displayRate if LP planner didn't already set netOutputRate
        // LP planner's netOutputRate is more accurate for self-consumption scenarios
        let displayRate: number | undefined;

        if (!n.netOutputRate) {
            // Look up consumption by ITEM name, not node ID
            const itemKey = n.itemName;
            const internalConsumption = consumption.get(itemKey) || 0;

            // If this item is being consumed internally, show net output
            if (internalConsumption > 0) {
                displayRate = n.rate - internalConsumption;
            }

            // DEBUG
            if (nodeKey.toLowerCase().includes("plank") || nodeKey.toLowerCase().includes("woodboard")) {
                console.log("[GraphMapper] Node display:", nodeKey, "itemKey:", itemKey, "gross:", n.rate, "consumption:", internalConsumption, "displayRate:", displayRate, "netOutputRate:", n.netOutputRate);
            }
        }

        return {
            id: nodeKey, // Use ID if distinct
            type: "custom",
            data: {
                ...n,
                inputItems: inputItemsByNode.get(nodeKey) || [],
                // Only set displayRate if we calculated it (and LP didn't provide netOutputRate)
                ...(displayRate !== undefined && { displayRate }),
            } as unknown as Record<string, unknown>,
            position: { x: 0, y: 0 },
        };
    });

    // Create Edges
    const rfEdges: Edge[] = [];

    edgeRates.forEach((rate, key) => {
        const [source, target] = key.split("___");
        const kind = edgeKinds.get(key);
        const isFuel = kind === "fuel";
        const color = isFuel ? "#EF4444" : "#F59E0B"; // heat edges red, product edges gold

        rfEdges.push({
            id: key,
            source,
            target,
            // Heat/fertilizer fan out from one source to every machine; hidden by default and kept out of the layout
            data: { utility: !!kind },
            targetHandle: inputHandleId({ item: edgeItems.get(key)!, kind: edgeKinds.get(key) }),
            animated: true,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed, color },
            style: { stroke: color, strokeWidth: 2, ...(isFuel && { strokeDasharray: "2 4" }) },

            // --- Label Logic ---
            label: `${rate.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2,
            })}/m`,
            labelStyle: { fill: isFuel ? "#f87171" : "#fbbf24", fontWeight: 700, fontSize: 11 },
            labelBgStyle: { fill: "#1c1917", fillOpacity: 0.8 },
            labelBgPadding: [4, 2],
            labelBgBorderRadius: 4,
        });
    });

    // ----------------------------------------------------
    // Output / Target Nodes
    // ----------------------------------------------------
    rootNodes.forEach((root, idx) => {
        if (root.isOrphanRoot) return; // no target node: it's surplus, shown on the node itself
        const targetId = `target-${root.itemName}-${idx}`;
        // Use netOutputRate if available (for LP planner with loops), otherwise use rate
        const outputRate = root.netOutputRate ?? root.rate;

        // Create Target Node
        rfNodes.push({
            id: targetId,
            type: "custom",
            data: {
                itemName: root.itemName,
                rate: outputRate,
                isRaw: false,
                deviceCount: 0,
                heatConsumption: 0,
                inputs: [],
                byproducts: [],
                isTarget: true, // Special Flag
            } as unknown as Record<string, unknown>,
            position: { x: 0, y: 0 },
        });

        // Create Edge from Production -> Target
        rfEdges.push({
            id: `${root.id || root.itemName}-${targetId}`,
            source: root.id || root.itemName,
            target: targetId,
            animated: true,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#10B981" }, // Green Arrow
            style: { stroke: "#10B981", strokeWidth: 2, strokeDasharray: "5 5" },

            // --- Label Logic (Target) ---
            label: `${outputRate.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2,
            })}/m`,
            labelStyle: { fill: "#4ade80", fontWeight: 700, fontSize: 11 },
            labelBgStyle: { fill: "#052e16", fillOpacity: 0.8 },
            labelBgPadding: [4, 2],
            labelBgBorderRadius: 4,
        });
    });

    // ----------------------------------------------------
    // Byproduct Output Nodes (secondary recipe outputs, e.g. Plank from sawing Rotten Log)
    // ----------------------------------------------------
    mergedNodes.forEach((node, key) => {
        node.byproducts.forEach((bp) => {
            if (bp.rate < 0.01) return;
            const bpId = `${key}-byproduct-${bp.itemName}`;
            rfNodes.push({
                id: bpId,
                type: "custom",
                data: {
                    itemName: bp.itemName,
                    rate: bp.remaining ?? bp.rate, // what is left after internal use
                    isRaw: false,
                    deviceCount: 0,
                    heatConsumption: 0,
                    inputs: [],
                    byproducts: [],
                    isByproduct: true,
                } as unknown as Record<string, unknown>,
                position: { x: 0, y: 0 },
            });
            rfEdges.push({
                id: `${key}-${bpId}`,
                source: key,
                target: bpId,
                animated: true,
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed, color: "#A78BFA" },
                style: { stroke: "#A78BFA", strokeWidth: 2, strokeDasharray: "5 5" },
                label: `${bp.rate.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}/m`,
                labelStyle: { fill: "#c4b5fd", fontWeight: 700, fontSize: 11 },
                labelBgStyle: { fill: "#1c1917", fillOpacity: 0.8 },
                labelBgPadding: [4, 2],
                labelBgBorderRadius: 4,
            });
        });
    });

    // Apply Layout (Dagre) -> Get default positions
    const layouted = await getLayoutedElements(rfNodes, rfEdges, algorithm);

    // Override with Saved Positions
    const nodesWithSavedPositions = layouted.nodes.map((node) => {
        if (savedPositions[node.id]) {
            return {
                ...node,
                position: savedPositions[node.id],
            };
        }
        return node;
    });

    return { nodes: nodesWithSavedPositions, edges: layouted.edges };
}
