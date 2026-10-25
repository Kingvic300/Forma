// Online forms: the form lives in the owner's own Supabase project so anyone with the link can
// answer it. Only the project's public key ever goes into a link; reading answers or changing
// the form needs an owner code that stays on the owner's computer.
import { getSetting, setSetting } from "./store";

export interface OnlineConfig {
  url: string;
  key: string;
}

/** Where a published form lives. Kept inside the form file; never exported or put in a link. */
export interface OnlineForm {
  id: string;
  token: string;
  accepting: boolean;
  lastId: number;
}

export const FILL_PAGE = "https://kingvic300.github.io/Forma/f/";

/** Run once in the Supabase SQL editor. Safe to run again. */
export const SETUP_SQL = `-- Forma online forms. Safe to run more than once.
create table if not exists public.forma_forms (
  id text primary key check (length(id) between 16 and 64),
  owner_hash text not null,
  definition jsonb not null check (pg_column_size(definition) < 200000),
  accepting boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.forma_responses (
  id bigint generated always as identity primary key,
  form_id text not null references public.forma_forms(id) on delete cascade,
  answers jsonb not null check (pg_column_size(answers) < 50000),
  created_at timestamptz not null default now()
);
create index if not exists forma_responses_form_idx on public.forma_responses (form_id, id);

-- Lock the tables: no policies, so they can only be reached through the functions below.
alter table public.forma_forms enable row level security;
alter table public.forma_responses enable row level security;
revoke all on public.forma_forms, public.forma_responses from anon, authenticated;

create or replace function public.forma_owner(p_id text, p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from forma_forms
    where id = p_id and owner_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  );
$$;

-- Owner: create or update a form.
create or replace function public.forma_publish(p_id text, p_token text, p_definition jsonb, p_accepting boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_token) < 32 then raise exception 'owner code too short'; end if;
  insert into forma_forms (id, owner_hash, definition, accepting)
  values (p_id, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), p_definition, p_accepting)
  on conflict (id) do update
    set definition = excluded.definition, accepting = excluded.accepting, updated_at = now()
    where forma_forms.owner_hash = excluded.owner_hash;
  if not found then raise exception 'This form belongs to someone else'; end if;
end $$;

-- Owner: answers received after a given answer number.
create or replace function public.forma_responses_since(p_id text, p_token text, p_after bigint)
returns table (rid bigint, answers jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not forma_owner(p_id, p_token) then raise exception 'Not the owner of this form'; end if;
  return query
    select r.id, r.answers, r.created_at from forma_responses r
    where r.form_id = p_id and r.id > p_after order by r.id limit 1000;
end $$;

-- Owner: stop sharing (removes the form and its answers from the database).
create or replace function public.forma_unpublish(p_id text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not forma_owner(p_id, p_token) then raise exception 'Not the owner of this form'; end if;
  delete from forma_forms where id = p_id;
end $$;

-- Anyone with the link: read the form (just the title once it stops accepting answers).
create or replace function public.forma_get_form(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when accepting then definition
              else jsonb_build_object('closed', true, 'title', definition->'title') end
  from forma_forms where id = p_id;
$$;

-- Anyone with the link: send answers.
create or replace function public.forma_submit(p_id text, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 50000 then
    raise exception 'These answers are too long';
  end if;
  if not exists (select 1 from forma_forms where id = p_id and accepting) then
    raise exception 'This form is no longer accepting responses';
  end if;
  insert into forma_responses (form_id, answers) values (p_id, p_answers);
end $$;

revoke execute on function public.forma_owner(text, text) from public, anon, authenticated;
grant execute on function public.forma_publish(text, text, jsonb, boolean),
  public.forma_responses_since(text, text, bigint), public.forma_unpublish(text, text),
  public.forma_get_form(text), public.forma_submit(text, jsonb) to anon, authenticated;
`;

const random = (bytes: number) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const newFormId = () => random(15); // 20 characters
export const newOwnerToken = () => random(32);

export const getOnlineConfig = () => getSetting<OnlineConfig>("online");
export const setOnlineConfig = (c: OnlineConfig | null) => setSetting("online", c);

/** Reject anything that isn't a Supabase project URL and public key, especially secret keys. */
export function checkConfig(url: string, key: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "The Project URL should look like https://abcdefgh.supabase.co";
  }
  if (u.protocol !== "https:" || !/\.supabase\.(co|in)$/.test(u.hostname)) return "The Project URL should look like https://abcdefgh.supabase.co";
  const k = key.trim();
  if (k.startsWith("sb_secret_")) return "That's the secret key. Use the publishable (public) key instead; it's safe to share.";
  if (k.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") return "That's the service_role key, which must stay secret. Use the anon public key instead.";
    } catch {
      return "That key doesn't look right. Copy the anon public key again.";
    }
  } else if (!k.startsWith("sb_publishable_")) return "That key doesn't look right. Copy the publishable or anon public key.";
  return null;
}

export const normalizeConfig = (c: OnlineConfig): OnlineConfig => ({ url: new URL(c.url.trim()).origin, key: c.key.trim() });

export async function rpc<T>(cfg: OnlineConfig, fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: cfg.key };
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`; // legacy anon key
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  } catch {
    throw new Error("Couldn't reach your Supabase project. Check your internet connection.");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 404 || body?.code === "PGRST202") throw new Error("Forma's setup code hasn't been run in this Supabase project yet.");
    if (res.status === 401 || res.status === 403) throw new Error("Supabase didn't accept the key. Copy the public key again in Settings.");
    throw new Error(body?.message ?? `Supabase returned an error (${res.status})`);
  }
  return body as T;
}

/** A link anyone can open. The part after # never reaches GitHub's servers. */
export function shareLink(cfg: OnlineConfig, formId: string) {
  const payload = btoa(JSON.stringify({ u: cfg.url, k: cfg.key, f: formId })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${FILL_PAGE}#${payload}`;
}
