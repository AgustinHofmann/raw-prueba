-- ============================================================================
-- RAW Design — SETUP COMPLETO DE LA BASE DE DATOS
-- ============================================================================
-- Un solo script que deja un proyecto Supabase vacío listo para producción,
-- con toda la seguridad incorporada desde el inicio.
--
-- Cómo usar:  Supabase → SQL Editor → pegar todo → Run.
-- Idempotente: se puede correr varias veces sin romper nada.
--
-- Reemplaza a: schema.sql + migration_add_user_id.sql +
--              migration_add_techpack.sql + security.sql
-- (esos quedan como historial; ESTE es el que hay que correr en una base nueva)
--
-- Contraseñas: NO se manejan acá a propósito. Las guarda Supabase Auth con
-- bcrypt + salt en el esquema privado `auth`. Nunca pasan por nuestras tablas
-- ni por el frontend. Implementar un manejo propio sería MENOS seguro.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. TABLAS
-- ────────────────────────────────────────────────────────────────────────────

-- Carpetas para organizar proyectos.
-- user_id con default auth.uid(): aunque el cliente no lo mande, la base pone
-- al usuario autenticado. Imposible crear filas a nombre de otro.
create table if not exists folders (
  id          uuid   primary key,
  user_id     uuid   references auth.users(id) on delete cascade default auth.uid(),
  name        text   not null,
  created_at  bigint not null,
  constraint folders_name_len check (char_length(name) <= 60)
);

-- Proyectos (prendas). canvas_json y techpack_json son documentos pesados que
-- se cargan de forma lazy (solo al abrir el proyecto / la ficha técnica).
create table if not exists projects (
  id            uuid   primary key,
  user_id       uuid   references auth.users(id) on delete cascade default auth.uid(),
  folder_id     uuid   references folders(id) on delete set null,
  name          text   not null,
  mockup_id     text   not null,
  thumbnail     text,
  canvas_json   text,
  techpack_json text,
  colors        text[] not null default '{}',
  tag           text   not null default '',
  created_at    bigint not null,
  updated_at    bigint not null,
  constraint projects_name_len check (char_length(name) <= 120),
  constraint projects_tag_len  check (char_length(tag)  <= 40)
);

-- Perfil público: el nickname del usuario.
-- El id ES el id de auth.users → un usuario = un perfil, y si se borra la
-- cuenta, el perfil cae en cascada.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Higiene del nickname: 3–24 caracteres, solo letras/números/guión bajo.
  -- Corta de raíz nicknames con HTML/scripts (<img onerror=…>), espacios o emojis.
  constraint nickname_len   check (char_length(nickname) between 3 and 24),
  constraint nickname_chars check (nickname ~ '^[A-Za-z0-9_]+$')
);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ÍNDICES
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists projects_updated_at_idx on projects(updated_at desc);
create index if not exists folders_created_at_idx  on folders(created_at desc);
-- Filtrar por dueño es la query más frecuente (la hace el RLS en cada consulta).
create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists folders_user_id_idx  on folders(user_id);
-- Unicidad de nickname SIN distinguir mayúsculas: si existe "Aaron", nadie
-- registra "aaron" (evita suplantación por lookalike).
create unique index if not exists profiles_nickname_unique on profiles (lower(nickname));


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
-- Sin esto, la anon key permitiría leer TODA la tabla. Con esto, la base filtra
-- por usuario en cada consulta: la seguridad no depende del frontend.
alter table folders  enable row level security;
alter table projects enable row level security;
alter table profiles enable row level security;

-- Permisos base para el rol `authenticated`.
--
-- Son DOS capas distintas y hacen falta las dos:
--   1. GRANT  → "¿este rol puede tocar la tabla?"  (permiso de Postgres)
--   2. RLS    → "¿qué FILAS puede tocar?"           (política por usuario)
-- Sin el GRANT, Postgres corta antes de evaluar el RLS y la API devuelve 403.
--
-- Hace falta explícitamente cuando el proyecto se crea con "Automatically
-- expose new tables" DESACTIVADO — que es justo lo recomendado por seguridad:
-- así ninguna tabla nueva queda accesible hasta que uno la habilite a mano.
--
-- Nótese que NO se otorga nada a `anon`: sin iniciar sesión no se lee nada.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.folders  to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update         on public.profiles to authenticated;
-- (profiles sin DELETE: un perfil solo desaparece si se borra la cuenta.)

-- Privilegio mínimo: sacar lo que Postgres/Supabase otorgan por defecto y que
-- ningún cliente necesita.
--   TRUNCATE es el más peligroso: vacía la tabla entera y el RLS NO se aplica
--   a TRUNCATE (las políticas filtran filas, pero TRUNCATE no mira filas).
--   REFERENCES y TRIGGER tampoco tienen sentido desde el navegador.
revoke truncate, references, trigger on public.folders  from anon, authenticated;
revoke truncate, references, trigger on public.projects from anon, authenticated;
revoke truncate, references, trigger on public.profiles from anon, authenticated;

-- `anon` (sin iniciar sesión) no debe poder tocar estas tablas de ninguna forma.
revoke all on public.folders  from anon;
revoke all on public.projects from anon;
revoke all on public.profiles from anon;

-- Políticas por operación (mínimo privilegio) en vez de una sola "for all":
-- más claro de auditar y se puede endurecer una sin tocar las demás.
drop policy if exists "folders_select"  on folders;
drop policy if exists "folders_insert"  on folders;
drop policy if exists "folders_update"  on folders;
drop policy if exists "folders_delete"  on folders;
drop policy if exists "projects_select" on projects;
drop policy if exists "projects_insert" on projects;
drop policy if exists "projects_update" on projects;
drop policy if exists "projects_delete" on projects;
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_insert" on profiles;
drop policy if exists "profiles_update" on profiles;

-- `(select auth.uid())` en vez de `auth.uid()`: Postgres lo evalúa una sola vez
-- por consulta (initPlan) en lugar de una vez por fila — misma seguridad, mejor
-- rendimiento cuando hay muchas filas.

-- Carpetas: solo las propias.
create policy "folders_select" on folders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "folders_insert" on folders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "folders_update" on folders
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "folders_delete" on folders
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Proyectos: solo los propios.
create policy "projects_select" on projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert" on projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update" on projects
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects_delete" on projects
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Perfiles: el nickname es público entre usuarios logueados (es el nombre
-- visible dentro de la app), pero solo podés crear/editar el TUYO.
create policy "profiles_select" on profiles
  for select to authenticated using (true);
create policy "profiles_insert" on profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update" on profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- (Sin DELETE: un perfil solo desaparece si se borra la cuenta.)


-- ────────────────────────────────────────────────────────────────────────────
-- 4. TRIGGERS
-- ────────────────────────────────────────────────────────────────────────────
-- updated_at lo pone la base, no el cliente (que podría mentir la fecha).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 5. VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- Debe devolver 3 filas, todas con:
--   rls_activo = true
--   politicas  = 4 (folders/projects) o 3 (profiles)
--   permisos   = 4 (folders/projects) o 3 (profiles)
--
-- Si `permisos` da 0, falta el GRANT: la API va a responder 403 aunque el RLS
-- esté bien. Si `rls_activo` da false, la tabla queda expuesta. Ambas importan.
select
  c.relname                                as tabla,
  c.relrowsecurity                         as rls_activo,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as politicas,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee = 'authenticated')     as permisos
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('projects','folders','profiles')
order by c.relname;
