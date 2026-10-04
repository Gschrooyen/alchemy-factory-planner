import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFactoryStore } from "../../store/useFactoryStore";

const iconButton =
    "p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--surface)]/50 transition-colors";

/** Pick the game server (world/save) whose factories and skills are shown. */
export function ServerPicker() {
    const { servers, activeServerId, setActiveServer, addServer, renameServer, removeServer } = useFactoryStore();
    const [renaming, setRenaming] = useState<string | null>(null);
    const active = servers.find((s) => s.id === activeServerId);
    if (!active) return null;

    const finishRename = () => {
        if (renaming?.trim()) renameServer(active.id, renaming.trim());
        setRenaming(null);
    };

    const remove = () => {
        if (window.confirm(`Delete server "${active.name}" and all its factories?`)) removeServer(active.id);
    };

    return (
        <div className="flex items-center gap-1 mr-2 pr-2 border-r border-[var(--border)] shrink-0">
            {renaming !== null ? (
                <input
                    autoFocus
                    aria-label="Server name"
                    className="bg-[var(--background-deep)] text-sm px-2 py-1 rounded border border-[var(--accent-gold)]/50 outline-none w-36 text-[var(--text-primary)]"
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => e.key === "Enter" && finishRename()}
                />
            ) : (
                <select
                    aria-label="Server"
                    value={active.id}
                    onChange={(e) => setActiveServer(e.target.value)}
                    className="appearance-none bg-[var(--surface)] text-sm text-[var(--text-primary)] px-2 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent-gold-dim)] outline-none cursor-pointer max-w-44"
                >
                    {servers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            )}
            <button title="Rename server" aria-label="Rename server" className={iconButton} onClick={() => setRenaming(active.name)}>
                <Pencil size={14} />
            </button>
            <button title="New server" aria-label="New server" className={iconButton} onClick={() => addServer()}>
                <Plus size={14} />
            </button>
            {servers.length > 1 && (
                <button title="Delete server" aria-label="Delete server" className={iconButton} onClick={remove}>
                    <Trash2 size={14} />
                </button>
            )}
        </div>
    );
}
