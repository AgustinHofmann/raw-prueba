-- ============================================================================
-- 0008 — Cuotas por usuario y tablas nuevas cerradas por defecto
-- ============================================================================
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de 0007.
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Dos huecos que el RLS no cubre, porque el RLS decide QUIÉN toca una fila,
-- no CUÁNTO puede guardar ni qué pasa con lo que se cree mañana:
--
--   1. Una sola cuenta podía llenar la base de todos. Cada proyecto acepta
--      hasta ~19 MB (dibujo + miniatura + ficha, límites de la 0005) y no había
--      tope de cantidad. El plan gratis tiene 500 MB EN TOTAL: alcanzaba con
--      un script que creara proyectos en loop para dejar la app sin lugar.
--
--   2. Supabase les da permisos automáticos a `anon` y `authenticated` sobre
--      cualquier tabla nueva de `public`. Una tabla creada desde el panel sin
--      acordarse del RLS quedaba legible y escribible para cualquiera con la
--      clave pública, que viaja en la app.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. CUOTAS POR USUARIO
-- ────────────────────────────────────────────────────────────────────────────
-- Holgadas a propósito: cortan el abuso, no el uso normal. Un diseñador con
-- 500 proyectos o 150 MB de diseños está muy lejos de lo que hace hoy cualquiera
-- de nosotros (los proyectos reales pesan entre 0,2 y 2 MB).
--
-- `security invoker`: corre con los permisos del que guarda, así que el RLS
-- le deja ver SOLO sus filas y la cuenta es exactamente la suya.
-- `pg_column_size`: tamaño real en disco (comprimido), sin descomprimir nada.

create or replace function public.cuota_proyectos()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cantidad integer;
  bytes    bigint;
begin
  -- La app guarda con upsert, y un upsert dispara el trigger de INSERT aunque
  -- la fila ya exista: por eso la cuenta excluye la fila que se está guardando.
  -- Si no, con 500 proyectos no se podía volver a guardar ninguno.
  if tg_op = 'INSERT' then
    select count(*) into cantidad from public.projects
     where user_id = new.user_id and id <> new.id;
    if cantidad >= 500 then
      raise exception 'Llegaste al máximo de 500 proyectos por cuenta'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(sum(coalesce(pg_column_size(canvas_json), 0)
                    + coalesce(pg_column_size(thumbnail), 0)
                    + coalesce(pg_column_size(techpack_json), 0)), 0)
    into bytes
    from public.projects
   where user_id = new.user_id and id <> new.id;

  bytes := bytes + coalesce(pg_column_size(new.canvas_json), 0)
                 + coalesce(pg_column_size(new.thumbnail), 0)
                 + coalesce(pg_column_size(new.techpack_json), 0);
  if bytes > 150 * 1024 * 1024 then
    raise exception 'Llegaste al máximo de 150 MB de diseños por cuenta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists projects_cuota on public.projects;
create trigger projects_cuota
  before insert or update of canvas_json, thumbnail, techpack_json on public.projects
  for each row execute function public.cuota_proyectos();

create or replace function public.cuota_carpetas()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.folders
       where user_id = new.user_id and id <> new.id) >= 200 then
    raise exception 'Llegaste al máximo de 200 carpetas por cuenta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists folders_cuota on public.folders;
create trigger folders_cuota
  before insert on public.folders
  for each row execute function public.cuota_carpetas();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. LO QUE SE CREE MAÑANA NACE CERRADO
-- ────────────────────────────────────────────────────────────────────────────
-- Desde acá, una tabla, función o secuencia nueva en `public` no le da nada a
-- nadie hasta que una migración lo diga explícitamente (con su RLS al lado).
-- Las tablas que ya existen no cambian: sus permisos están puestos en la 0005.
alter default privileges for role postgres in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

-- Las funciones de este proyecto son todas de triggers: nadie tiene por qué
-- llamarlas a mano por la API.
revoke execute on all functions in schema public from anon, authenticated, public;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS EN TODO `public`, SIN EXCEPCIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- Red de seguridad para tablas creadas desde el panel que no pasaron por una
-- migración: les prende el RLS. Sin políticas, una tabla con RLS no muestra
-- nada a nadie, que es el lado seguro del error. Si alguna hacía falta, se le
-- escriben sus políticas en una migración propia.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS activado en public.%', t.relname;
  end loop;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- Cada tabla de public: RLS prendido, cuántas políticas tiene y qué puede
-- hacer `anon` (tiene que ser 0 en todas).
select
  c.relname                                                            as tabla,
  c.relrowsecurity                                                     as rls_activo,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)          as politicas,
  (select count(*) from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee = 'anon')                                           as perm_anon,
  (select string_agg(tgname, ', ') from pg_trigger
    where tgrelid = c.oid and not tgisinternal)                         as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
