/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import type { AdminDb } from "@/lib/admin/__tests__/db-harness";

// Shared fixtures for the collaboration database tests.
export type Person = { id: string; email: string };

export function makeHelpers(getDb: () => AdminDb) {
  const db = () => getDb();
  async function person(name: string, plan: "free" | "pro" = "free", label: "student" | "supervisor" = "student"): Promise<Person> {
    const email = `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
    const id = await db().user(email);
    await db().pool.query("insert into public.profiles (id, role, full_name) values ($1, $2, $3) on conflict (id) do update set role = excluded.role, full_name = excluded.full_name", [id, label, name]);
    if (plan === "pro") await subscribe(id);
    return { id, email };
  }
  async function subscribe(id: string, plan = "pro") {
    await db().pool.query(
      `insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id)
       values ($1, $3, 'active', now() - interval '1 day', now() + interval '20 days', 'dodo', $2)
       on conflict (user_id) do update set plan = excluded.plan, status = 'active', current_period_end = excluded.current_period_end`, [id, `sub_${id}`, plan]);
  }
  async function project(owner: string, title = "Study"): Promise<string> {
    const id = (await db().pool.query("insert into public.studies (owner_id, title) values ($1, $2) returning id", [owner, title])).rows[0].id as string;
    await db().pool.query("insert into public.protocol_versions (study_id, version_number, status, study_title, research_question) values ($1, 1, 'draft', $2, 'Does X cause Y?')", [id, title]);
    return id;
  }
  const invite = (actor: string, study: string, email: string, role: string, label: string | null = null) =>
    db().rpc<{ invitation_id: string; token: string }>("collab_invite", { p_actor: actor, p_study: study, p_email: email, p_role: role, p_label: label });
  async function join(owner: string, study: string, member: Person, role: string) {
    const inv = await invite(owner, study, member.email, role);
    return db().rpc("collab_accept", { p_actor: member.id, p_token: inv.token });
  }
  const as = <T = any>(user: string, sql: string, params: unknown[] = []) => db().asRole<T>("authenticated", user, sql, params);
  // Like `as`, but commits, for tests that must see the effect of a write made by a browser session.
  async function asWrite<T = any>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
    const c = await db().pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      const r = await c.query(sql, params);
      await c.query("commit");
      return r.rows;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  return { person, subscribe, project, invite, join, as, asWrite };
}
