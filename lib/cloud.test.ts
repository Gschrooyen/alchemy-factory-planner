import { describe, expect, test } from "bun:test";
import { diffRows, fromFactoryRow, toFactoryRow } from "./cloud";
import { DEFAULT_RESEARCH, migrateV0, type FactoryData } from "../store/useFactoryStore";

const factory = (id: string, serverId = "s1"): FactoryData => ({
  id,
  serverId,
  name: `F ${id}`,
  targets: [{ item: "plank", rate: 10 }],
  availableResources: [],
  config: {} as FactoryData["config"],
  viewMode: "graph",
  plannerMode: "lp",
  nodes: [{ id: "n1", position: { x: 1, y: 2 }, data: { label: "x", inputs: [{}], byproducts: [{}] } }],
  edges: [],
  productionTrees: [{} as FactoryData["productionTrees"][number]],
  viewport: { x: 0, y: 0, zoom: 1 },
  active: false,
});

describe("cloud sync", () => {
  test("v0 local data moves into one server with its research", () => {
    const research = { ...DEFAULT_RESEARCH, alchemySkill: 7 };
    const { servers, activeServerId, factories } = migrateV0({ factories: [factory("a"), factory("b")], research });
    expect(servers).toHaveLength(1);
    expect(servers[0].research.alchemySkill).toBe(7);
    expect(factories.every((f) => f.serverId === activeServerId)).toBe(true);
  });

  test("factory round-trips through a row without its computed plan", () => {
    const row = toFactoryRow(factory("a"));
    expect(row.server_id).toBe("s1");
    expect("productionTrees" in row.data && row.data.productionTrees).toEqual([]);
    const back = fromFactoryRow(JSON.parse(JSON.stringify(row)));
    expect(back.id).toBe("a");
    expect(back.serverId).toBe("s1");
    expect(back.targets).toEqual([{ item: "plank", rate: 10 }]);
    expect(back.nodes[0].data).toEqual({ label: "x", inputs: [], byproducts: [] });
  });

  test("diff finds changed and removed rows by content", () => {
    const a = toFactoryRow(factory("a"));
    const b = toFactoryRow(factory("b"));
    const snapshot = new Map([a, b].map((r) => [r.id, JSON.stringify(r)]));
    expect(diffRows(snapshot, [a, b])).toEqual({ changed: [], removed: [] });

    const renamed = { ...a, name: "renamed" };
    const c = toFactoryRow(factory("c"));
    expect(diffRows(snapshot, [renamed, c])).toEqual({ changed: [renamed, c], removed: ["b"] });
  });
});
