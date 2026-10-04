// Proves row-level security keeps accounts apart: a second user (and an anonymous caller)
// must not read, change, delete or take over another user's servers and factories.
// Creates two throwaway users and removes them again.
//   bun --env-file=.env.local supabase/isolation-check.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function signedInUser(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { id: data.user.id, client };
}

const victim = await signedInUser("victim");
const attacker = await signedInUser("attacker");
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const failures: string[] = [];

try {
  const sid = crypto.randomUUID(), fid = crypto.randomUUID();
  for (const r of [
    await victim.client.from("servers").insert({ id: sid, name: "victim server", research: {} }),
    await victim.client.from("factories").insert({ id: fid, server_id: sid, name: "victim factory", data: {} }),
  ]) if (r.error) throw r.error;

  const check = (name: string, ok: boolean) => !ok && failures.push(name);
  const blocked = async (c: SupabaseClient, who: string) => {
    check(`${who} reads servers`, (await c.from("servers").select("id").eq("id", sid)).data?.length === 0);
    check(`${who} reads factories`, (await c.from("factories").select("id").eq("id", fid)).data?.length === 0);
    check(`${who} updates factory`, !(await c.from("factories").update({ name: "pwned" }).eq("id", fid).select()).data?.length);
    check(`${who} deletes factory`, !(await c.from("factories").delete().eq("id", fid).select()).data?.length);
    check(`${who} deletes server`, !(await c.from("servers").delete().eq("id", sid).select()).data?.length);
    check(`${who} upserts over factory id`, !!(await c.from("factories").upsert({ id: fid, server_id: sid, name: "pwned", data: {} })).error);
    check(`${who} adds factory to server`, !!(await c.from("factories").insert({ id: crypto.randomUUID(), server_id: sid, name: "x", data: {} })).error);
    check(`${who} inserts row as victim`, !!(await c.from("servers").insert({ id: crypto.randomUUID(), user_id: victim.id, name: "x", research: {} })).error);
  };
  await blocked(attacker.client, "other user");
  await blocked(anon, "anonymous");
  check("anonymous calls delete_my_account", !!(await anon.rpc("delete_my_account")).error);

  const f = await admin.from("factories").select("name").eq("id", fid).single();
  check("victim factory intact", f.data?.name === "victim factory");

  // the owner can delete their own account, and their data goes with it
  check("owner deletes own account", !(await victim.client.rpc("delete_my_account")).error);
  check("owner data removed", (await admin.from("servers").select("id").eq("id", sid)).data?.length === 0);
} finally {
  await admin.auth.admin.deleteUser(victim.id).catch(() => {});
  await admin.auth.admin.deleteUser(attacker.id);
}

console.log(failures.length ? `FAILED:\n- ${failures.join("\n- ")}` : "ok: accounts are isolated");
process.exit(failures.length ? 1 : 0);
