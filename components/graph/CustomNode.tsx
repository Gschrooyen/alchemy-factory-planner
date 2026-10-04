import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, Flame, Settings, Trash2 } from "lucide-react";
import { ProductionNode } from "../../engine/types";
import { cn } from "../../lib/utils";
import { inputHandleId, type GraphInputItem } from "../../lib/graphMapper";
import { MachineCountInput } from "../dashboard/MachineCountInput";
import { CauldronSwapButton } from "../dashboard/CauldronWizard";
import { ParadoxSwapButton } from "../dashboard/ParadoxPicker";
import { RecipeSwapButton } from "../dashboard/RecipePicker";
import { DoneToggle, useDone } from "../dashboard/DoneToggle";

export function CustomNode({ data }: { data: ProductionNode & { displayRate?: number; inputItems?: GraphInputItem[] } }) {
    // Cast to access properties safely if TS complains
    const nodeData = data as ProductionNode & { displayRate?: number; inputItems?: GraphInputItem[] };
    const inputItems = nodeData.inputItems || [];
    const productInputs = inputItems.filter((i) => i.kind !== "fuel");
    const fuelInputs = inputItems.filter((i) => i.kind === "fuel");

    const inputRow = (i: GraphInputItem) => (
        <div key={inputHandleId(i)} className="relative text-[10px] leading-[18px] truncate text-[var(--text-muted)]">
            <Handle
                type="target"
                position={Position.Left}
                id={inputHandleId(i)}
                style={{ left: -18 }}
                className={cn(
                    "!w-2.5 !h-2.5 !border-2 !border-[var(--surface)]",
                    i.kind === "fuel" ? "!bg-[var(--error)]" : "!bg-[var(--accent-purple-dim)]",
                )}
            />
            {i.item}
            {i.kind === "fertilizer" && <span className="opacity-60"> (fertilizer)</span>}
        </div>
    );

    const isMachine = nodeData.deviceCount > 0;
    const nodeKey = nodeData.id ?? nodeData.itemName;
    const done = useDone().isDone(nodeKey);
    const isSaturated = nodeData.isBeltSaturated;
    const isTarget = nodeData.isTarget;
    const isByproduct = (nodeData as { isByproduct?: boolean }).isByproduct;

    // Use netOutputRate if available (LP planner sets this for self-consuming items),
    // then displayRate (graphMapper calculated), otherwise use rate (gross production)
    const rateToShow = nodeData.netOutputRate ?? nodeData.displayRate ?? nodeData.rate;

    return (
        <div
            className={cn(
                "p-3 rounded-lg border shadow-lg min-w-[220px] bg-[var(--surface)] transition-all relative",
                isTarget
                    ? "border-[var(--success)] bg-[var(--success-dim)]/30 glow-gold-subtle"
                    : isByproduct
                        ? "border-[var(--accent-purple-dim)] bg-[var(--accent-purple)]/10"
                        : isMachine
                        ? "border-[var(--accent-gold-dim)] hover:border-[var(--accent-gold)]"
                        : "border-[var(--border)] hover:border-[var(--accent-purple-dim)]",
                isSaturated && !isTarget && "border-[var(--error)] bg-[var(--error-dim)]/20 shadow-[0_0_15px_rgba(224,85,85,0.2)]",
                done && "opacity-60 border-[var(--success)]/60",
            )}
        >
            {/* Corner decorations for machine nodes */}
            {isMachine && !isTarget && (
                <>
                    <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-[var(--accent-gold-dim)] rounded-tl pointer-events-none"></div>
                    <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-[var(--accent-gold-dim)] rounded-br pointer-events-none"></div>
                </>
            )}

            {/* Header */}
            <div className="flex justify-between items-start gap-2 mb-2 pb-2 border-b border-[var(--border-subtle)]">
                {isMachine && <DoneToggle nodeKey={nodeKey} className="mt-0.5" />}
                <span
                    className={cn(
                        "font-bold text-sm truncate flex-1",
                        isTarget
                            ? "text-[var(--success)]"
                            : isMachine
                                ? "text-[var(--accent-gold-bright)]"
                                : "text-[var(--text-secondary)]",
                    )}
                >
                    {isTarget ? "Production Target" : isByproduct ? `Byproduct: ${nodeData.itemName}` : nodeData.itemName}
                </span>
                <div className="text-right">
                    <div
                        className={cn(
                            "text-xs font-mono font-bold px-1.5 py-0.5 rounded",
                            isTarget
                                ? "text-[var(--success)] bg-[var(--success-dim)]/30"
                                : isSaturated
                                    ? "text-[var(--error)] bg-[var(--error-dim)]/30"
                                    : "text-[var(--accent-gold)]",
                        )}
                    >
                        {nodeData.planted ? (
                            <span title="Planted once per nursery, not used up">plant ×{rateToShow.toLocaleString()}</span>
                        ) : (
                            <>
                                {rateToShow.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                })}
                                /m
                            </>
                        )}
                    </div>
                    {isSaturated && !isTarget && (
                        <div className="text-[8px] text-[var(--error)] flex items-center justify-end gap-0.5 mt-0.5">
                            <AlertTriangle size={8} /> Limit
                        </div>
                    )}
                    {/* Net shown above; say where the rest of the gross output goes */}
                    {nodeData.netOutputRate != null && nodeData.rate - nodeData.netOutputRate > 0.01 && (
                        <div className="text-[8px] text-[var(--text-muted)] text-right mt-0.5 whitespace-nowrap" title="Gross production minus what this factory feeds back into itself">
                            net of {nodeData.rate.toLocaleString(undefined, { maximumFractionDigits: 1 })} made · {(nodeData.rate - nodeData.netOutputRate).toLocaleString(undefined, { maximumFractionDigits: 1 })} used inside
                        </div>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="space-y-1.5">
                {isByproduct && rateToShow > 0.01 && (
                    <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        <Trash2 size={10} /> leftover → trash barrel
                    </div>
                )}

                {isTarget && (
                    <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                        <span className="font-bold">{nodeData.itemName}</span>
                    </div>
                )}

                {isMachine && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--background-deep)]/50 p-1.5 rounded">
                        <Settings size={12} className="text-[var(--accent-purple)]" />
                        <span className="text-[var(--accent-gold-bright)] font-bold">
                            <MachineCountInput node={nodeData} />x
                        </span>
                        <span className="truncate max-w-[100px]">{nodeData.deviceId}</span>
                        <CauldronSwapButton node={nodeData} />
                        <ParadoxSwapButton node={nodeData} />
                        <RecipeSwapButton node={nodeData} />
                    </div>
                )}

                {/* A byproduct can be made on purpose instead: same swap buttons as a machine node */}
                {isByproduct && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span>make it elsewhere:</span>
                        <RecipeSwapButton node={nodeData} />
                        <CauldronSwapButton node={nodeData} />
                        <ParadoxSwapButton node={nodeData} />
                    </div>
                )}

                {nodeData.surplus && nodeData.surplus > 0.01 ? (
                    <div className="text-xs text-[var(--accent-purple-bright)]">
                        +{nodeData.surplus.toFixed(1)}/m surplus
                    </div>
                ) : null}

                {nodeData.byproducts.filter((bp) => bp.recycled).map((bp) => (
                    <div key={bp.itemName} className="text-xs text-[var(--accent-purple-bright)]" title="Loop this output back into the same machines' input">
                        ↻ {bp.recycled!.toLocaleString(undefined, { maximumFractionDigits: 1 })}/m {bp.itemName} fed back in
                    </div>
                ))}

                {nodeData.heatConsumption > 0 && (
                    <div className="flex items-center gap-2 text-xs text-[var(--warning)]">
                        <Flame size={12} />
                        <span className="font-mono">{nodeData.heatConsumption.toLocaleString()} Heat</span>
                    </div>
                )}
            </div>

            {/* Inputs: one labelled row + handle per incoming item so edges stay distinct.
                Product inputs first; heat (fuel) inputs in their own red-tinted section. */}
            {productInputs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-0.5">
                    {productInputs.map(inputRow)}
                </div>
            )}
            {fuelInputs.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-dashed border-[var(--error)]/40 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-[var(--error)] leading-[18px]">
                        <Flame size={9} /> Heat
                    </div>
                    {fuelInputs.map(inputRow)}
                </div>
            )}

            {/* Handles for Edges */}
            {inputItems.length === 0 && (
                <Handle
                    type="target"
                    position={Position.Left}
                    className="!w-2.5 !h-2.5 !bg-[var(--accent-purple-dim)] !border-2 !border-[var(--surface)]"
                />
            )}
            {/* Targets usually don't have source, but we leave it flexible */}
            {!isTarget && (
                <Handle
                    type="source"
                    position={Position.Right}
                    className="!w-2.5 !h-2.5 !bg-[var(--accent-gold-dim)] !border-2 !border-[var(--surface)]"
                />
            )}
        </div>
    );
}
