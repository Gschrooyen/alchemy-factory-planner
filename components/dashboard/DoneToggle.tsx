"use client";

import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { useFactoryStore } from "../../store/useFactoryStore";

/** Machines the active factory has marked as built in-game, keyed by production node id. */
export function useDone() {
    const { factories, activeFactoryId, toggleDone, clearDone } = useFactoryStore();
    const factory = factories.find((f) => f.id === activeFactoryId);
    const done = new Set(factory?.done ?? []);
    return {
        done,
        isDone: (key: string) => done.has(key),
        toggle: (key: string) => activeFactoryId && toggleDone(activeFactoryId, key),
        clear: () => activeFactoryId && clearDone(activeFactoryId),
    };
}

/** Checkbox-style button: tick a machine group off once it is built. */
export function DoneToggle({ nodeKey, className }: { nodeKey: string; className?: string }) {
    const { isDone, toggle } = useDone();
    const checked = isDone(nodeKey);
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={(e) => { e.stopPropagation(); toggle(nodeKey); }}
            title={checked ? "Built - click to undo" : "Mark as built"}
            className={cn(
                "nodrag shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                checked
                    ? "bg-[var(--success)] border-[var(--success)] text-[var(--background-deep)]"
                    : "border-[var(--border)] hover:border-[var(--success)] text-transparent",
                className,
            )}
        >
            <Check size={12} strokeWidth={3} />
        </button>
    );
}
