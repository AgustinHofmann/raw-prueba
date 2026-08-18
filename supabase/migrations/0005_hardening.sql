-- ============================================================================
-- 0005 — Endurecimiento de la base (integridad + privilegio mínimo)
-- ============================================================================
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de 0004.
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Punto de partida real, medido contra la base viva (no contra los .sql del repo):
--   · un GET sin sesión a projects/folders/profiles devolvía 200 [] y no 403
--     → el rol `anon` conservaba el GRANT de SELECT y lo único que lo separaba
--       de los datos era el RLS. Una sola capa.
--   · user_id nullable, TRUNCATE concedido, folder_id sin dueño, updated_at
--     puesto por el cliente y cero límites de tamaño.
--
-- Contraseñas: no se tocan acá a propósito. Las guarda Supabase Auth (bcrypt +
-- salt) en el esquema privado `auth`; nunca pasan por nuestras tablas ni por el
-- frontend. Construir un manejo propio sería MENOS seguro.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. PRE-CONDICIONES
-- ────────────────────────────────────────────────────────────────────────────
-- Los pasos 3 y 4 no pueden aplicarse sobre datos inconsistentes. En vez de
-- saltearlos en silencio (que es justo lo que dejó el bug de techpack_json
-- invisible dos semanas), la migración corta con un mensaje que dice qué
-- limpiar. Se arregla, se vuelve a correr y listo.
do $$
declare
  huerfanos_p bigint;
  huerfanos_f bigint;
  cruzados    bigint;
begin
  select count(*) into huerfanos_p from public.projects where user_id is null;
  select count(*) into huerfanos_f from public.folders  where user_id is null;

  if huerfanos_p > 0 or huerfanos_f > 0 then
    raise exception
      'Hay filas sin dueño (projects: %, folders: %). Son invisibles para todos por el RLS y no se pueden borrar desde la app. Asignales un user_id o borralas, y volvé a correr esta migración.',
      huerfanos_p, huerfanos_f;
  end if;

  -- Proyectos guardados dentro de una carpeta de OTRO usuario.
  select count(*) into cruzados
  from public.projects p
  join public.folders  f on f.id = p.folder_id
  where f.user_id is distinct from p.user_id;

  if cruzados > 0 then
    raise exception
      'Hay % proyecto(s) dentro de carpetas de otro usuario. Corregí con: update public.projects p set folder_id = null from public.folders f where f.id = p.folder_id and f.user_id is distinct from p.user_id;',
      cruzados;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PERMISOS: cerrarle la puerta a `anon`
-- ────────────────────────────────────────────────────────────────────────────
-- GRANT y RLS son dos capas distintas y hacen falta las dos:
--   GRANT → "¿este rol puede tocar la tabla?"   (permiso de Postgres)
--   RLS   → "¿qué FILAS puede tocar?"            (política por usuario)
-- Con el GRANT puesto, un pedido sin sesión llegaba a evaluarse y solo lo
-- frenaba el RLS. Sin el GRANT, Postgres corta antes: defensa en profundidad.
revoke all on public.folders  from anon;
revoke all on public.projects from anon;
revoke all on public.profiles from anon;

-- Y a `authenticated`, solo lo que la app realmente usa.
--   TRUNCATE es el peligroso: vacía la tabla entera y el RLS NO lo frena
--   (las políticas filtran filas; TRUNCATE no mira filas).
--   REFERENCES y TRIGGER no tienen ningún sentido desde el navegador.
revoke truncate, references, trigger on public.folders  from authenticated;
revoke truncate, references, trigger on public.projects from authenticated;
revoke truncate, references, trigger on public.profiles from authenticated;

-- Confirmar lo que sí necesita (por si alguna tabla quedó sin exponer).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.folders  to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update         on public.profiles to authenticated;
-- profiles nunca necesito DELETE, pero el GRANT estaba puesto igual (venia de
-- antes). El RLS lo bloqueaba porque no hay politica de DELETE, pero el permiso
-- sobraba: misma logica de dos capas que con anon.
revoke delete on public.profiles from authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS activo (por si alguna tabla quedó sin él)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.folders  enable row level security;
alter table public.projects enable row level security;
alter table public.profiles enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. DUEÑO OBLIGATORIO
-- ────────────────────────────────────────────────────────────────────────────
-- user_id era nullable. El RLS igual bloqueaba (auth.uid() = NULL da NULL, no
-- true), pero una fila sin dueño queda invisible para TODOS y no hay forma de
-- borrarla desde la app: basura permanente. Con NOT NULL no puede existir.
alter table public.projects alter column user_id set default auth.uid();
alter table public.folders  alter column user_id set default auth.uid();
alter table public.projects alter column user_id set not null;
alter table public.folders  alter column user_id set not null;

-- El id lo venía generando el cliente (crypto.randomUUID()). El RLS ya impedía
-- pisar una fila ajena, pero con default la base deja de depender del cliente.
alter table public.projects alter column id set default gen_random_uuid();
alter table public.folders  alter column id set default gen_random_uuid();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. UNA CARPETA AJENA YA NO ACEPTA MIS PROYECTOS
-- ────────────────────────────────────────────────────────────────────────────
-- La FK apuntaba solo a folders(id): cualquiera podía mandar el UUID de una
-- carpeta ajena en folder_id (no la puede LEER, pero sí referenciarla), y al
-- borrarse esa carpeta el ON DELETE SET NULL le movía el proyecto de lugar.
-- Con la FK compuesta, el aislamiento por usuario lo garantiza la base.
do $$ begin
  alter table public.folders add constraint folders_id_user_id_key unique (id, user_id);
exception when duplicate_table or duplicate_object then null; end $$;

alter table public.projects drop constraint if exists projects_folder_id_fkey;
alter table public.projects drop constraint if exists projects_folder_owner_fkey;

-- ON DELETE SET NULL (folder_id): la lista de columnas es de PostgreSQL 15+.
-- Sin ella, el SET NULL también anularía user_id y chocaría con el NOT NULL de
-- arriba, dejando imposible borrar una carpeta.
do $$ begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'Se necesita PostgreSQL 15+ para ON DELETE SET NULL (columna). Versión actual: %',
      current_setting('server_version');
  end if;
  alter table public.projects
    add constraint projects_folder_owner_fkey
    foreign key (folder_id, user_id) references public.folders(id, user_id)
    on delete set null (folder_id);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. FECHAS QUE PONE LA BASE, NO EL CLIENTE
-- ────────────────────────────────────────────────────────────────────────────
-- `upsertProject` mandaba updated_at: Date.now() desde el navegador — o sea que
-- el orden de la biblioteca ("últimos editados") dependía del reloj del cliente
-- y era falsificable. Ahora lo pone un trigger.
--
-- `set search_path = ''` + `security invoker`: una función sin search_path fijo
-- es vulnerable a search-path hijacking (alguien crea un esquema propio con una
-- función homónima y termina ejecutándose la suya). Es exactamente lo que marca
-- el linter de Supabase como `function_search_path_mutable`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.created_at = old.created_at;   -- created_at es inmutable
  return new;
end $$;

-- projects/folders guardan epoch en milisegundos (bigint), no timestamptz:
-- necesitan su propia versión.
create or replace function public.set_updated_at_ms()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = (extract(epoch from now()) * 1000)::bigint;
  new.created_at = old.created_at;   -- created_at es inmutable
  return new;
end $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at_ms();

-- Y valores por defecto, para que un INSERT sin fechas también sea correcto.
alter table public.projects alter column created_at set default (extract(epoch from now()) * 1000)::bigint;
alter table public.projects alter column updated_at set default (extract(epoch from now()) * 1000)::bigint;
alter table public.folders  alter column created_at set default (extract(epoch from now()) * 1000)::bigint;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. LÍMITES DE TAMAÑO Y DE VALORES (anti-abuso)
-- ────────────────────────────────────────────────────────────────────────────
-- No es teórico: HomeScreen importa un proyecto desde un .json que elige el
-- usuario y lo sube tal cual, y `thumbnail` es un PNG entero en base64. Sin
-- límites, una sola cuenta puede llenar la base con una sola fila.
--
-- NOT VALID: aplica a todo lo que entre de ahora en más, sin exigir revalidar
-- las filas históricas (que además bloquearía la tabla mientras las escanea).
-- Los topes son holgados a propósito: cortan el abuso, no el uso normal.
do $$ begin
  alter table public.projects add constraint projects_thumbnail_len
    check (thumbnail is null or char_length(thumbnail) <= 3000000) not valid;         --  ~3 MB
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.projects add constraint projects_canvas_len
    check (canvas_json is null or char_length(canvas_json) <= 12000000) not valid;    -- ~12 MB (puede llevar imágenes embebidas)
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.projects add constraint projects_techpack_len
    check (techpack_json is null or char_length(techpack_json) <= 4000000) not valid; --  ~4 MB
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.projects add constraint projects_colors_len
    check (coalesce(array_length(colors, 1), 0) <= 64
       and coalesce(char_length(array_to_string(colors, ',')), 0) <= 2048) not valid;
exception when duplicate_object then null; end $$;

-- mockup_id venía como texto libre pese a que el tipo del front es
-- 'tshirt' | 'hoodie' | 'pants'. Ahora la base también lo sabe.
do $$ begin
  alter table public.projects add constraint projects_mockup_id_valido
    check (mockup_id in ('tshirt', 'hoodie', 'pants')) not valid;
exception when duplicate_object then null; end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. ÍNDICES
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists projects_user_id_idx   on public.projects(user_id);
create index if not exists folders_user_id_idx    on public.folders(user_id);
create index if not exists projects_folder_id_idx on public.projects(folder_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 8. VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- Esperado en las 3 filas:
--   rls_activo   = true
--   politicas    = 4 (projects/folders) o 3 (profiles)
--   perm_authent = 4 (projects/folders) o 3 (profiles)
--   perm_anon    = 0   ← el cambio principal de esta migración
select
  c.relname        as tabla,
  c.relrowsecurity as rls_activo,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)          as politicas,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee = 'authenticated')                                  as perm_authent,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee = 'anon')                                           as perm_anon
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('projects', 'folders', 'profiles')
order by c.relname;
