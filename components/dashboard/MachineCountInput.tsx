import { RotateCcw } from "lucide-react";
import { ProductionNode } from "../../engine/types";
import { useFactoryStore } from "../../store/useFactoryStore";

/** Editable machine count; blank = let the planner decide. LP planner only. */
export function MachineCountInput({ node }: { node: ProductionNode }) {
    const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
    const factory = factories.find((f) => f.id === activeFactoryId);
    const override = node.recipeId ? factory?.config.machineOverrides?.[node.recipeId] : undefined;
    const editable = factory?.plannerMode === "lp" && !!node.recipeId;

    if (!editable) {
        return <>{node.deviceCount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>;
    }

    const set = (raw: string) => {
        const { [node.recipeId!]: _, ...rest } = factory!.config.machineOverrides ?? {};
        const n = parseFloat(raw);
        updateFactoryConfig(factory!.id, {
            machineOverrides: n > 0 ? { ...rest, [node.recipeId!]: n } : rest,
        });
    };

    return (
        <span className="inline-flex items-center gap-1">
        <input
            type="number"
            min={0}
            step={1}
            className={`nodrag w-14 bg-transparent border-b text-center outline-none ${override ? "border-[var(--accent-gold)] text-[var(--accent-gold-bright)]" : "border-[var(--border)]"}`}
            title="Machines built (blank = auto)"
            value={override ?? Number(node.deviceCount.toFixed(2))}
            onChange={(e) => set(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.currentTarget.blur()} // scroll-zooming the graph must not change the value
        />
        {override !== undefined && (
            <button
                type="button"
                className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
                title="Reset to auto"
                onClick={() => set("")}
            >
                <RotateCcw size={10} />
            </button>
        )}
        </span>
    );
}
