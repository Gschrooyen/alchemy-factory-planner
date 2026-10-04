
import {
    Edge,
    EdgeChange,
    Node,
    NodeChange,
    Viewport,
    applyEdgeChanges,
    applyNodeChanges,
} from "@xyflow/react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { calculateProduction } from "../engine/planner";
import { calculateProductionLP } from "../engine/lp-planner";
import {
    FactoryState,
    PlannerConfig,
    PlannerMode,
    ProductionNode,
    ResearchState,
} from "../engine/types";
import { generateGraph } from "../lib/graphMapper";
import type { LayoutAlgorithm } from "../components/graph/layout";
import type { SharedFactory } from "../lib/share";

// Extended Factory Data to include visual state
export interface FactoryData extends FactoryState {
    nodes: Node[];
    edges: Edge[];
    productionTrees: ProductionNode[];
    viewport: Viewport;
    active: boolean;
    done?: string[]; // production node ids marked as built in-game
    serverId: string;
}

/** A game world/save: research is per server, factories belong to one. */
export interface ServerData {
    id: string;
    name: string;
    research: ResearchState;
}

// Initial Research State
export const DEFAULT_RESEARCH: ResearchState = {
    logisticsEfficiency: 0,
    throwingEfficiency: 0,
    factoryEfficiency: 0,
    alchemySkill: 0,
    fuelEfficiency: 0,
    fertilizerEfficiency: 0,
    salesAbility: 0,
    negotiationSkill: 0,
    customerMgmt: 0,
    relicKnowledge: 0,
};

// Initial Factory config
const DEFAULT_FACTORY_CONFIG: Omit<
    PlannerConfig,
    "targets" | "targetItem" | "targetRate" | "availableResources"
> = {
    factoryEfficiency: 0,
    alchemySkill: 0,
    fuelEfficiency: 0,
    logisticsEfficiency: 1,
    fertilizerEfficiency: 0,
    salesAbility: 0,
    throwingEfficiency: 0,
    negotiationSkill: 0,
    customerMgmt: 0,
    relicKnowledge: 0,
    selectedFertilizer: "",
    selectedFuel: "",
    selfFuel: true,
    selfFertilizer: true,
    optimizeFor: "cost",
    machineCost: 25,
    useThermalExtractor: false,
    thermalExtractorFloors: 0,
};

interface FactoryStore {
    // State
    servers: ServerData[];
    activeServerId: string | null;
    factories: FactoryData[];
    activeFactoryId: string | null;
    research: ResearchState; // the active server's research, mirrored into servers[] on every change
    syncedUserId: string | null; // account this device last synced with (lib/cloud.ts)

    // Servers
    addServer: (name?: string) => void;
    renameServer: (id: string, name: string) => void;
    removeServer: (id: string) => void;
    setActiveServer: (id: string) => void;
    /** Swap in servers/factories from the cloud, keeping the active selection when it still exists. */
    replaceAll: (servers: ServerData[], factories: FactoryData[]) => void;
    setSyncedUserId: (id: string | null) => void;

    // Actions
    addFactory: () => void;
    importFactory: (shared: SharedFactory) => void;
    removeFactory: (id: string) => void;
    renameFactory: (id: string, name: string) => void;
    setActiveFactory: (id: string) => void;

    // Configuration Updates
    setResearch: (field: keyof ResearchState, value: number) => void;
    setResearchBulk: (updates: Partial<ResearchState>) => void;
    resetResearch: () => void;

    updateFactoryConfig: (id: string, updates: Partial<PlannerConfig>) => void;
    updateFactoryTargets: (
        id: string,
        targets: { item: string; rate: number }[]
    ) => void;
    updateFactoryAvailableResources: (
        id: string,
        resources: { item: string; rate: number }[]
    ) => void;

    // Graph Logic
    calculateAndLayout: () => void; // Uses current state to calc
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onViewportChange: (viewport: Viewport) => void;
    setViewMode: (id: string, mode: "graph" | "list") => void;
    setPlannerMode: (id: string, mode: PlannerMode) => void;
    resetFactoryLayout: (id: string) => void;
    showUtilityEdges: boolean;
    layoutAlgorithm: LayoutAlgorithm;
    setLayoutAlgorithm: (a: LayoutAlgorithm) => void;
    toggleUtilityEdges: () => void;
    toggleDone: (id: string, nodeKey: string) => void;
    clearDone: (id: string) => void;
}

/**
 * What gets saved (localStorage and cloud): productionTrees has circular refs and is
 * recalculated from targets + config, and node.data carries copies of it.
 */
export function toStoredFactory(f: FactoryData): FactoryData {
    return {
        ...f,
        productionTrees: [],
        nodes: f.nodes.map((n) => ({
            ...n,
            data: n.data ? { ...n.data, inputs: [], byproducts: [] } : n.data,
        })),
    };
}

/** Research update for the active server, kept in sync with its entry in servers[]. */
function withResearch(state: FactoryStore, research: ResearchState) {
    return {
        research,
        servers: state.servers.map((s) => (s.id === state.activeServerId ? { ...s, research } : s)),
    };
}

export function newServer(name: string, research: ResearchState = DEFAULT_RESEARCH): ServerData {
    return { id: crypto.randomUUID(), name, research };
}

/** v0 had no servers: put everything in one, carrying over the global research. */
export function migrateV0(old: { factories?: Omit<FactoryData, "serverId">[]; research?: ResearchState }) {
    const server = newServer("My server", old.research ?? DEFAULT_RESEARCH);
    return {
        servers: [server],
        activeServerId: server.id,
        factories: (old.factories ?? []).map((f) => ({ ...f, serverId: server.id })),
    };
}

export const useFactoryStore = create<FactoryStore>()(
    persist(
        (set, get) => ({
            servers: [],
            activeServerId: null,
            factories: [],
            activeFactoryId: null,
            research: DEFAULT_RESEARCH,
            syncedUserId: null,
            setSyncedUserId: (id) => set({ syncedUserId: id }),

            addServer: (name) => {
                const server = newServer(name || `Server ${get().servers.length + 1}`);
                set((s) => ({ servers: [...s.servers, server] }));
                get().setActiveServer(server.id);
            },

            renameServer: (id, name) =>
                set((s) => ({ servers: s.servers.map((sv) => (sv.id === id ? { ...sv, name } : sv)) })),

            removeServer: (id) => {
                if (get().servers.length <= 1) return;
                const wasActive = get().activeServerId === id;
                set((s) => ({
                    servers: s.servers.filter((sv) => sv.id !== id),
                    factories: s.factories.filter((f) => f.serverId !== id),
                }));
                if (wasActive) get().setActiveServer(get().servers[0].id);
            },

            setActiveServer: (id) => {
                const server = get().servers.find((s) => s.id === id);
                if (!server) return;
                // the page adds a factory when a server has none
                const first = get().factories.find((f) => f.serverId === id);
                set({ activeServerId: id, research: server.research, activeFactoryId: first?.id ?? null });
                get().calculateAndLayout();
            },

            replaceAll: (servers, factories) => {
                const { activeServerId, activeFactoryId } = get();
                const serverId = servers.some((s) => s.id === activeServerId) ? activeServerId : servers[0]?.id ?? null;
                const server = servers.find((s) => s.id === serverId);
                const factoryId = factories.some((f) => f.id === activeFactoryId && f.serverId === serverId)
                    ? activeFactoryId
                    : factories.find((f) => f.serverId === serverId)?.id ?? null;
                set({
                    servers,
                    factories,
                    activeServerId: serverId,
                    activeFactoryId: factoryId,
                    research: server?.research ?? DEFAULT_RESEARCH,
                });
                get().calculateAndLayout();
            },
            showUtilityEdges: false,
            layoutAlgorithm: "layered",
            setLayoutAlgorithm: (a) => { set({ layoutAlgorithm: a }); const id = get().activeFactoryId; if (id) get().resetFactoryLayout(id); },
            toggleUtilityEdges: () => set((s) => ({ showUtilityEdges: !s.showUtilityEdges })),
            toggleDone: (id, nodeKey) => set((s) => ({
                factories: s.factories.map((f) => f.id !== id ? f : { ...f, done: f.done?.includes(nodeKey) ? f.done.filter((k) => k !== nodeKey) : [...(f.done ?? []), nodeKey] }),
            })),
            clearDone: (id) => set((s) => ({ factories: s.factories.map((f) => (f.id !== id ? f : { ...f, done: [] })) })),

            addFactory: () => {
                const id = crypto.randomUUID();
                const serverId = get().activeServerId;
                if (!serverId) return;
                const newFactory: FactoryData = {
                    id,
                    serverId,
                    name: `Factory ${get().factories.filter((f) => f.serverId === serverId).length + 1}`,
                    targets: [],
                    availableResources: [],
                    config: DEFAULT_FACTORY_CONFIG,
                    viewMode: "graph",
                    plannerMode: "lp",
                    nodes: [],
                    edges: [],
                    productionTrees: [],
                    active: false,
                    viewport: { x: 0, y: 0, zoom: 1 },
                };

                set((state) => ({
                    factories: [...state.factories, newFactory],
                    activeFactoryId: id,
                }));
            },

            // A shared link: new tab with the shared inputs, skills applied, plan computed
            importFactory: (shared) => {
                const id = crypto.randomUUID();
                const serverId = get().activeServerId;
                if (!serverId) return;
                const factory: FactoryData = {
                    id,
                    serverId,
                    name: shared.name || `Factory ${get().factories.length + 1}`,
                    targets: shared.targets,
                    availableResources: shared.availableResources ?? [],
                    config: { ...DEFAULT_FACTORY_CONFIG, ...shared.config },
                    viewMode: "graph",
                    plannerMode: shared.plannerMode ?? "lp",
                    nodes: [],
                    edges: [],
                    productionTrees: [],
                    active: false,
                    viewport: { x: 0, y: 0, zoom: 1 },
                };
                set((state) => ({
                    factories: [...state.factories, factory],
                    activeFactoryId: id,
                    ...withResearch(state, { ...state.research, ...shared.research }),
                }));
                get().calculateAndLayout();
            },

            removeFactory: (id) => {
                set((state) => {
                    const serverId = state.factories.find((f) => f.id === id)?.serverId;
                    if (state.factories.filter((f) => f.serverId === serverId).length <= 1) return state;

                    const newFactories = state.factories.filter((f) => f.id !== id);
                    let newActiveId = state.activeFactoryId;

                    if (state.activeFactoryId === id) {
                        newActiveId = newFactories.find((f) => f.serverId === serverId)!.id;
                    }

                    return { factories: newFactories, activeFactoryId: newActiveId };
                });
            },

            renameFactory: (id, name) => {
                set((state) => ({
                    factories: state.factories.map((f) =>
                        f.id === id ? { ...f, name } : f
                    ),
                }));
            },

            setActiveFactory: (id) => {
                set({ activeFactoryId: id });
                // productionTrees aren't persisted, so a factory that wasn't active at load has none yet
                if (get().factories.find((f) => f.id === id)?.productionTrees.length === 0) get().calculateAndLayout();
            },

            setResearch: (field, value) => {
                set((state) => withResearch(state, { ...state.research, [field]: value }));
                // Trigger recalc immediately?
                get().calculateAndLayout();
            },

            setResearchBulk: (updates) => {
                set((state) => withResearch(state, { ...state.research, ...updates }));
                get().calculateAndLayout();
            },

            resetResearch: () => {
                set((state) => withResearch(state, DEFAULT_RESEARCH));
                get().calculateAndLayout();
            },

            updateFactoryConfig: (id, updates) => {
                set((state) => ({
                    factories: state.factories.map((f) => {
                        if (f.id !== id) return f;

                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { targets: _targets, ...safeUpdates } = updates;
                        return {
                            ...f,
                            config: { ...f.config, ...safeUpdates },
                        };
                    }),
                }));
                get().calculateAndLayout();
            },

            updateFactoryTargets: (id, targets) => {
                set((state) => ({
                    factories: state.factories.map((f) =>
                        f.id === id ? { ...f, targets } : f
                    ),
                }));
                get().calculateAndLayout();
            },

            updateFactoryAvailableResources: (id, resources) => {
                set((state) => ({
                    factories: state.factories.map((f) =>
                        f.id === id ? { ...f, availableResources: resources } : f
                    ),
                }));
                get().calculateAndLayout();
            },

            setViewMode: (id, mode) => {
                set((state) => ({
                    factories: state.factories.map((f) =>
                        f.id === id ? { ...f, viewMode: mode } : f
                    ),
                }));
            },

            setPlannerMode: (id, mode) => {
                set((state) => ({
                    factories: state.factories.map((f) =>
                        f.id === id ? { ...f, plannerMode: mode } : f
                    ),
                }));
                get().calculateAndLayout();
            },

            calculateAndLayout: () => {
                const state = get();
                const activeId = state.activeFactoryId;
                if (!activeId) return;

                const factory = state.factories.find((f) => f.id === activeId);
                if (!factory || factory.targets.length === 0) {
                    if (
                        factory &&
                        (factory.nodes.length > 0 || factory.edges.length > 0)
                    ) {
                        set((s) => ({
                            factories: s.factories.map((f) =>
                                f.id === activeId ? { ...f, nodes: [], edges: [] } : f
                            ),
                        }));
                    }
                    return;
                }

                const calculationConfig: PlannerConfig = {
                    targets: factory.targets,
                    availableResources: factory.availableResources,
                    ...factory.config,
                    ...state.research,
                    selectedFertilizer: factory.config.selectedFertilizer,
                    selectedFuel: factory.config.selectedFuel,
                    selfFuel: factory.config.selfFuel,
                    selfFertilizer: factory.config.selfFertilizer,
                };

                const productionNodes = factory.plannerMode === "lp"
                    ? calculateProductionLP(calculationConfig)
                    : calculateProduction(calculationConfig);

                const currentNodes = factory.nodes;
                const savedPositions: Record<string, { x: number; y: number }> = {};
                currentNodes.forEach((n) => {
                    savedPositions[n.id] = n.position;
                });

                // Layout is async (ELK); trees are set right away so the list view and summary don't wait
                set((s) => ({
                    factories: s.factories.map((f) => (f.id === activeId ? { ...f, productionTrees: productionNodes } : f)),
                }));
                generateGraph(productionNodes, savedPositions, state.layoutAlgorithm).then(({ nodes, edges }) =>
                    set((s) => ({
                        factories: s.factories.map((f) => (f.id === activeId ? { ...f, nodes, edges } : f)),
                    }))
                );
            },

            resetFactoryLayout: (id) => {
                const state = get();
                const factory = state.factories.find((f) => f.id === id);
                if (!factory || factory.targets.length === 0) return;

                const calculationConfig: PlannerConfig = {
                    targets: factory.targets,
                    availableResources: factory.availableResources,
                    ...factory.config,
                    ...state.research,
                    selectedFertilizer: factory.config.selectedFertilizer,
                    selectedFuel: factory.config.selectedFuel,
                    selfFuel: factory.config.selfFuel,
                    selfFertilizer: factory.config.selfFertilizer,
                };

                const productionNodes = factory.plannerMode === "lp"
                    ? calculateProductionLP(calculationConfig)
                    : calculateProduction(calculationConfig);

                generateGraph(productionNodes, {}, state.layoutAlgorithm).then(({ nodes, edges }) =>
                    set((s) => ({
                        factories: s.factories.map((f) =>
                            f.id === id ? { ...f, nodes, edges, productionTrees: productionNodes, viewport: { x: 0, y: 0, zoom: 1 } } : f
                        ),
                    }))
                );
            },


            onNodesChange: (changes) => {
                set((state) => ({
                    factories: state.factories.map((f) => {
                        if (f.id !== state.activeFactoryId) return f;
                        return { ...f, nodes: applyNodeChanges(changes, f.nodes) };
                    }),
                }));
            },

            onEdgesChange: (changes) => {
                set((state) => ({
                    factories: state.factories.map((f) => {
                        if (f.id !== state.activeFactoryId) return f;
                        return { ...f, edges: applyEdgeChanges(changes, f.edges) };
                    }),
                }));
            },

            onViewportChange: (viewport) => {
                set((state) => ({
                    factories: state.factories.map((f) => {
                        if (f.id !== state.activeFactoryId) return f;
                        return { ...f, viewport };
                    }),
                }));
            },
        }),
        {
            name: "alchemy-factory-store", // unique name for localStorage
            storage: createJSONStorage(() => localStorage),
            version: 1,
            migrate: (persisted, version) => {
                const old = persisted as Parameters<typeof migrateV0>[0];
                return (version === 0 ? { ...old, ...migrateV0(old) } : old) as unknown as FactoryStore;
            },
            partialize: (state) => ({
                servers: state.servers,
                activeServerId: state.activeServerId,
                factories: state.factories.map(toStoredFactory),
                activeFactoryId: state.activeFactoryId,
                research: state.research,
                layoutAlgorithm: state.layoutAlgorithm,
                syncedUserId: state.syncedUserId,
            }),
            onRehydrateStorage: () => (state) => {
                // Recalculate production trees after loading from localStorage
                if (state) {
                    // Use setTimeout to ensure store is fully initialized
                    setTimeout(() => {
                        state.calculateAndLayout();
                    }, 0);
                }
            },
        }
    )
);
