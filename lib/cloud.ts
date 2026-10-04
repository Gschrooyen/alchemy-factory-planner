import { createClient } from "@supabase/supabase-js";
import { create } from "zustand";
import {
  toStoredFactory,
  useFactoryStore,
  type FactoryData,
  type ServerData,
} from "@/store/useFactoryStore";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** null when the deployment has no Supabase project: the app then stays local-only. */
export const supabase = url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;

export type SyncStatus = "off" | "syncing" | "synced" | "error";
export const useSyncStatus = create<{ status: SyncStatus }>(() => ({ status: "off" }));
const setStatus = (status: SyncStatus) => useSyncStatus.setState({ status });

// Row content as stored, without user_id/updated_at (added on push)
type ServerRow = { id: string; name: string; research: ServerData["research"] };
type FactoryRow = { id: string; server_id: string; name: string; data: Omit<FactoryData, "id" | "name" | "serverId"> };
type Versioned<T> = T & { updated_at: string };

const toServerRow = (s: ServerData): ServerRow => ({ id: s.id, name: s.name, research: s.research });

export function toFactoryRow(f: FactoryData): FactoryRow {
  const { id, name, serverId, ...data } = toStoredFactory(f);
  return { id, server_id: serverId, name, data };
}

export const fromFactoryRow = (r: FactoryRow): FactoryData => ({ ...r.data, id: r.id, name: r.name, serverId: r.server_id, productionTrees: [] });

/** Rows whose content differs from the last synced snapshot, and ids that are gone. */
export function diffRows<T extends { id: string }>(snapshot: Map<string, string>, rows: T[]) {
  const ids = new Set(rows.map((r) => r.id));
  return {
    changed: rows.filter((r) => snapshot.get(r.id) !== JSON.stringify(r)),
    removed: [...snapshot.keys()].filter((id) => !ids.has(id)),
  };
}

// ---- sync session ----
// ponytail: last write wins per server/factory; edits made on two devices before either syncs keep only the later one.

type Session = {
  userId: string;
  servers: Map<string, string>; // id -> JSON of last synced row
  factories: Map<string, string>;
  versions: Map<string, string>; // id -> updated_at last seen in the cloud
  timer?: ReturnType<typeof setTimeout>;
  pushing?: Promise<boolean>;
  stop: () => void;
};
let session: Session | null = null;
let applying = false;

async function pull() {
  const [s, f] = await Promise.all([
    supabase!.from("servers").select("id,name,research,updated_at"),
    supabase!.from("factories").select("id,server_id,name,data,updated_at"),
  ]);
  if (s.error || f.error) return null;
  return { servers: s.data as Versioned<ServerRow>[], factories: f.data as Versioned<FactoryRow>[] };
}

async function upload(userId: string, servers: ServerRow[], factories: FactoryRow[], goneServers: string[], goneFactories: string[]) {
  const now = new Date().toISOString();
  const stamp = <T,>(rows: T[]) => rows.map((r) => ({ ...r, user_id: userId, updated_at: now }));
  const db = supabase!;
  // servers before factories (foreign key); factory deletes before server deletes
  const steps = [
    servers.length ? () => db.from("servers").upsert(stamp(servers)) : null,
    factories.length ? () => db.from("factories").upsert(stamp(factories)) : null,
    goneFactories.length ? () => db.from("factories").delete().in("id", goneFactories) : null,
    goneServers.length ? () => db.from("servers").delete().in("id", goneServers) : null,
  ];
  for (const step of steps) {
    if (step && (await step()).error) return null;
  }
  return now;
}

/** Load cloud rows into the store, reusing local objects that haven't changed (keeps their computed plans). */
function apply(remote: NonNullable<Awaited<ReturnType<typeof pull>>>) {
  const s = session!;
  const st = useFactoryStore.getState();
  const unchanged = remote.servers.length + remote.factories.length === s.versions.size &&
    [...remote.servers, ...remote.factories].every((r) => s.versions.get(r.id) === r.updated_at);
  if (unchanged) return;

  const keep = <T extends { id: string }, R extends { id: string; updated_at: string }>(rows: R[], local: T[], from: (r: R) => T) =>
    rows.map((r) => {
      const l = local.find((x) => x.id === r.id);
      return l && s.versions.get(r.id) === r.updated_at ? l : from(r);
    });
  const servers = keep(remote.servers, st.servers, (r) => ({ id: r.id, name: r.name, research: r.research }));
  const factories = keep(remote.factories, st.factories, fromFactoryRow);

  applying = true;
  try {
    st.replaceAll(servers, factories);
  } finally {
    applying = false;
  }
  s.versions = new Map([...remote.servers, ...remote.factories].map((r) => [r.id, r.updated_at]));
  snapshot();
}

function snapshot() {
  const st = useFactoryStore.getState();
  session!.servers = new Map(st.servers.map((sv) => [sv.id, JSON.stringify(toServerRow(sv))]));
  session!.factories = new Map(st.factories.map((f) => [f.id, JSON.stringify(toFactoryRow(f))]));
}

async function flush(): Promise<boolean> {
  const s = session;
  if (!s) return true;
  clearTimeout(s.timer);
  s.timer = undefined;
  if (s.pushing) await s.pushing;
  const st = useFactoryStore.getState();
  const sv = diffRows(s.servers, st.servers.map(toServerRow));
  const fc = diffRows(s.factories, st.factories.map(toFactoryRow));
  if (!sv.changed.length && !sv.removed.length && !fc.changed.length && !fc.removed.length) return true;

  setStatus("syncing");
  s.pushing = upload(s.userId, sv.changed, fc.changed, sv.removed, fc.removed).then((now) => {
    if (session !== s) return false;
    if (!now) {
      setStatus("error");
      s.timer = setTimeout(flush, 10_000); // retry; the snapshot still holds the unsynced diff
      return false;
    }
    for (const r of [...sv.changed, ...fc.changed]) s.versions.set(r.id, now);
    for (const id of [...sv.removed, ...fc.removed]) s.versions.delete(id);
    sv.changed.forEach((r) => s.servers.set(r.id, JSON.stringify(r)));
    fc.changed.forEach((r) => s.factories.set(r.id, JSON.stringify(r)));
    sv.removed.forEach((id) => s.servers.delete(id));
    fc.removed.forEach((id) => s.factories.delete(id));
    setStatus("synced");
    return true;
  });
  const ok = await s.pushing;
  s.pushing = undefined;
  return ok;
}

/** Start syncing the store with this user's cloud data. Call after the store has hydrated. */
export async function startSync(userId: string) {
  stopSync();
  if (!supabase) return;
  const s: Session = { userId, servers: new Map(), factories: new Map(), versions: new Map(), stop: () => {} };
  session = s;
  setStatus("syncing");

  let remote = await pull();
  if (session !== s) return;
  if (!remote) return setStatus("error");

  const local = useFactoryStore.getState();
  if (local.syncedUserId !== userId) {
    // First sync on this device: keep local work, unless it's only the untouched starter factory
    const hasWork = local.factories.some((f) => f.targets.length > 0);
    if (remote.servers.length === 0 || hasWork) {
      const inCloud = new Set([...remote.servers, ...remote.factories].map((r) => r.id));
      const ok = await upload(
        userId,
        local.servers.filter((sv) => !inCloud.has(sv.id)).map(toServerRow),
        local.factories.filter((f) => !inCloud.has(f.id)).map(toFactoryRow),
        [],
        [],
      );
      if (session !== s) return;
      if (!ok || !(remote = await pull())) return setStatus("error");
    }
    useFactoryStore.getState().setSyncedUserId(userId);
  }
  apply(remote);
  setStatus("synced");

  const unsubscribe = useFactoryStore.subscribe((st, prev) => {
    if (applying || (st.servers === prev.servers && st.factories === prev.factories)) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(flush, 1000);
  });
  // Pick up edits from other devices when coming back to the tab
  const onFocus = async () => {
    if (session !== s || s.timer || s.pushing) return;
    const fresh = await pull();
    if (fresh && session === s && !s.timer && !s.pushing) apply(fresh);
  };
  window.addEventListener("focus", onFocus);
  s.stop = () => {
    unsubscribe();
    window.removeEventListener("focus", onFocus);
    clearTimeout(s.timer);
  };
}

export function stopSync() {
  session?.stop();
  session = null;
  setStatus("off");
}

/** Push pending edits, sign out, and clear this device's copy of the account's data. */
export async function signOut() {
  await flush();
  stopSync();
  await supabase?.auth.signOut();
  clearLocal();
}

/** Delete the account and everything in it (servers and factories cascade). Returns an error message on failure. */
export async function deleteAccount(): Promise<string | null> {
  if (!supabase) return null;
  stopSync();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return error.message;
  await supabase.auth.signOut({ scope: "local" }); // the session's user no longer exists server-side
  clearLocal();
  return null;
}

function clearLocal() {
  const st = useFactoryStore.getState();
  st.replaceAll([], []);
  st.setSyncedUserId(null);
}
