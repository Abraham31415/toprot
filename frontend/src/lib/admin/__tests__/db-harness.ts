/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the database reports are untyped JSON and are only read field by field */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, types } from "pg";

// Admin console tests run against an isolated scratch Postgres (NOT Supabase, NOT production) with EVERY migration applied, so the
// functions are exercised against the real schema. Default matches the throwaway cluster used in development; override with
// TEST_PG_URL (a server URL without a database name).
types.setTypeParser(1082, (v) => v);
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_admin_test";
const MIGRATIONS = path.resolve(__dirname, "../../../../../supabase/migrations");

// The pieces of Supabase the migrations lean on: roles, the auth schema, storage and auth.uid()/auth.jwt().
const SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now(),
  raw_user_meta_data jsonb default '{}'::jsonb, last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
`;

export class AdminDb {
  pool!: Pool;

  static async create(): Promise<AdminDb> {
    const admin = new Pool({ connectionString: `${SERVER_URL}/postgres`, max: 1 });
    await admin.query(`drop database if exists ${DB_NAME} with (force)`);
    await admin.query(`create database ${DB_NAME}`);
    await admin.end();
    const db = new AdminDb();
    db.pool = new Pool({ connectionString: `${SERVER_URL}/${DB_NAME}`, max: 20 });
    await db.pool.query(SHIM);
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) await db.pool.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    return db;
  }

  close() { return this.pool.end(); }

  /** Calls public.<fn>(named args) and returns the single value, or throws the database error. */
  async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const names = Object.keys(args);
    const values = names.map((k) => (args[k] !== null && typeof args[k] === "object" && !(args[k] instanceof Date) ? JSON.stringify(args[k]) : args[k]));
    const r = await this.pool.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, values);
    return r.rows[0].r as T;
  }

  /** Same call, expecting a database error whose message contains the given text. */
  async rpcFails(fn: string, args: Record<string, unknown>, text: string): Promise<void> {
    let message = "";
    try { await this.rpc(fn, args); } catch (e) { message = (e as Error).message; }
    if (!message.includes(text)) throw new Error(`Expected ${fn} to fail with "${text}" but got: ${message || "no error"}`);
  }

  async user(email?: string): Promise<string> {
    const id = randomUUID();
    await this.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email ?? `${id.slice(0, 8)}@test.local`]);
    return id;
  }

  async admin(role: "owner" | "admin" | "viewer" = "admin"): Promise<string> {
    const id = await this.user();
    await this.pool.query("insert into public.app_admins (user_id, role) values ($1, $2)", [id, role]);
    return id;
  }

  /** Runs SQL as a browser role (what a signed-in or anonymous visitor's request would run as). */
  async asRole<T = any>(role: "anon" | "authenticated", sub: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      if (sub) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
      const r = await c.query(sql, params);
      await c.query("rollback");
      return r.rows;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
}
