import { describe, expect, test } from "bun:test";
import { diffRows, fromFactoryRow, planMerge, toFactoryRow } from "./cloud";
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

  describe("first sign-in merge", () => {
    const server = (id: string, name: string, alchemySkill = 0) => ({ id, name, research: { ...DEFAULT_RESEARCH, alchemySkill } });
    const blank = (id: string, serverId: string) => ({ ...factory(id, serverId), targets: [] });

    test("empty account takes everything local as is", () => {
      const plan = planMerge({ servers: [server("s1", "My server")], factories: [factory("a"), blank("b", "s1")] }, { servers: [], factories: [] });
      expect(plan.servers.map((s) => s.id)).toEqual(["s1"]);
      expect(plan.factories.map((f) => f.id)).toEqual(["a", "b"]);
    });

    test("same-named server joins the account's, skills take the higher level", () => {
      const plan = planMerge(
        { servers: [server("local", " my SERVER ", 5)], factories: [factory("a", "local")] },
        { servers: [server("cloud", "My server", 3)], factories: [{ id: "c1" }] },
      );
      expect(plan.servers).toEqual([{ id: "cloud", name: "My server", research: { ...DEFAULT_RESEARCH, alchemySkill: 5 } }]);
      expect(plan.factories.map((f) => [f.id, f.server_id])).toEqual([["a", "cloud"]]);
    });

    test("account skills that are already higher aren't re-uploaded", () => {
      const plan = planMerge(
        { servers: [server("local", "My server", 1)], factories: [factory("a", "local")] },
        { servers: [server("cloud", "My server", 4)], factories: [] },
      );
      expect(plan.servers).toEqual([]);
      expect(plan.factories[0].server_id).toBe("cloud");
    });

    test("blank starters are left out; a new server with work is added", () => {
      const plan = planMerge(
        {
          servers: [server("local1", "My server"), server("local2", "Second world")],
          factories: [blank("starter", "local1"), factory("w", "local2")],
        },
        { servers: [server("cloud", "My server")], factories: [] },
      );
      expect(plan.servers.map((s) => s.id)).toEqual(["local2"]);
      expect(plan.factories.map((f) => [f.id, f.server_id])).toEqual([["w", "local2"]]);
    });

    test("blank local data into an account with data uploads nothing", () => {
      const plan = planMerge(
        { servers: [server("local", "My server")], factories: [blank("starter", "local")] },
        { servers: [server("cloud", "My server")], factories: [{ id: "c1" }] },
      );
      expect(plan).toEqual({ servers: [], factories: [] });
    });
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
