-- ============================================================================
-- RAW Design — Seguridad de la base de datos (ejecutar en Supabase → SQL Editor)
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Cubre:
--   1. Tabla `profiles` (nicknames) con RLS, unicidad e higiene de datos.
--   2. RLS de `projects` y `folders` versionado como código (antes solo
--      existía en el panel), con políticas por operación.
--   3. Defensa en profundidad: límites de tamaño y user_id automático.
--
-- Nota sobre contraseñas: NO se tocan acá a propósito. Las guarda Supabase
-- Auth (bcrypt + salt) en el esquema privado `auth`; nunca pasan por nuestras
-- tablas ni por el frontend. Construir un manejo propio sería MENOS seguro.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES — nickname público de cada usuario
-- ────────────────────────────────────────────────────────────────────────────
-- El id ES el id del usuario en auth.users: un usuario = un perfil, y si la
-- cuenta se borra, el perfil cae en cascada.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Higiene del nickname: 3–24 caracteres, solo letras/números/guión bajo.
  -- Corta de raíz nicknames con HTML/scripts (<img …>), espacios o emojis.
  constraint nickname_len    check (char_length(nickname) between 3 and 24),
  constraint nickname_chars  check (nickname ~ '^[A-Za-z0-9_]+$')
);

-- Unicidad SIN distinguir mayúsculas: si existe "Aaron", nadie registra "aaron"
-- (evita suplantación por lookalike).
create unique index if not exists profiles_nickname_unique
  on profiles (lower(nickname));

alter table profiles enable row level security;

-- Políticas por operación (mínimo privilegio):
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_insert" on profiles;
drop policy if exists "profiles_update" on profiles;

-- Leer: cualquier usuario logueado puede ver nicknames (son el nombre público
-- dentro de la app). Los anónimos no ven nada.
create policy "profiles_select" on profiles
  for select to authenticated
  using (true);

-- Crear: solo MI perfil (id = mi uid). Nadie puede crear perfiles ajenos.
create policy "profiles_insert" on profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- Editar: solo MI perfil, y sin poder re-apuntarlo a otro usuario.
create policy "profiles_update" on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- (Sin política de DELETE: un perfil solo desaparece si se borra la cuenta.)

-- updated_at automático: el cliente no puede mentir la fecha.
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
-- 2. RLS de PROJECTS y FOLDERS — ahora versionado como código
-- ────────────────────────────────────────────────────────────────────────────
alter table projects enable row level security;
alter table folders  enable row level security;

-- Reemplaza la política única "for all" creada a mano en el panel por
-- políticas por operación (más claras de auditar y de endurecer una por una).
drop policy if exists "proyectos propios" on projects;
drop policy if exists "carpetas propias"  on folders;
drop policy if exists "projects_select" on projects;
drop policy if exists "projects_insert" on projects;
drop policy if exists "projects_update" on projects;
drop policy if exists "projects_delete" on projects;
drop policy if exists "folders_select" on folders;
drop policy if exists "folders_insert" on folders;
drop policy if exists "folders_update" on folders;
drop policy if exists "folders_delete" on folders;

-- `(select auth.uid())` en vez de `auth.uid()`: Postgres lo evalúa una sola
-- vez por consulta (initPlan) en lugar de una vez por fila — misma seguridad,
-- mejor rendimiento con muchas filas.
create policy "projects_select" on projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert" on projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update" on projects
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "projects_delete" on projects
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "folders_select" on folders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "folders_insert" on folders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "folders_update" on folders
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "folders_delete" on folders
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Defensa en profundidad
-- ────────────────────────────────────────────────────────────────────────────
-- user_id automático: aunque el cliente NO mande user_id, la base lo completa
-- con el usuario autenticado. Combinado con el WITH CHECK de arriba, es
-- imposible insertar filas a nombre de otro.
alter table projects alter column user_id set default auth.uid();
alter table folders  alter column user_id set default auth.uid();

-- Límites de tamaño (anti-abuso: nadie guarda un "nombre" de 5 MB).
-- NOT VALID: aplica solo a filas nuevas, no exige revalidar las históricas.
do $$ begin
  alter table projects add constraint projects_name_len
    check (char_length(name) <= 120) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table projects add constraint projects_tag_len
    check (char_length(tag) <= 40) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table folders add constraint folders_name_len
    check (char_length(name) <= 60) not valid;
exception when duplicate_object then null; end $$;
