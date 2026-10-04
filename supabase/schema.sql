-- Accounts: user -> servers -> factories. Run once in the Supabase SQL editor.
-- Each row belongs to the signed-in user; row-level security keeps users to their own rows.

create table public.servers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  research jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.factories (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  server_id uuid not null references public.servers on delete cascade,
  name text not null,
  data jsonb not null, -- the factory as the app stores it locally, minus computed plans
  updated_at timestamptz not null default now()
);

create index on public.servers (user_id);
create index on public.factories (user_id);
create index on public.factories (server_id);

alter table public.servers enable row level security;
alter table public.factories enable row level security;

create policy "own servers" on public.servers for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own factories" on public.factories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.servers s where s.id = server_id and s.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.servers, public.factories to authenticated;

-- Lets a signed-in user delete their own account; their servers and factories cascade with it.
create function public.delete_my_account() returns void
language sql security definer set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
