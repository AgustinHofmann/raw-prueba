-- ============================================================================
-- 0009 — Links para compartir un diseño (solo para mirar)
-- ============================================================================
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de 0008.
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Un diseño se comparte con un link (…/#c=<token>) que cualquiera puede abrir
-- sin cuenta: un cliente, el taller, un socio. Lo que se ve es una IMAGEN del
-- diseño tomada al compartir, el nombre y la prenda. Nada más: ni el dibujo
-- editable, ni la ficha, ni los otros proyectos.
--
-- Cómo se cuida:
--   · Nadie escribe la tabla directo. Se comparte con compartir_proyecto(),
--     que comprueba que el proyecto sea de quien lo pide, y el token lo genera
--     la base: el navegador no puede elegirlo ni pisar el de otro.
--   · Sin sesión no se puede leer ninguna tabla. Se mira con ver_compartido(),
--     que devuelve UN diseño y solo a quien tiene su token exacto: no hay
--     forma de listar ni de adivinar links (el token tiene 244 bits al azar).
--   · Topes: una imagen de 1,5 MB como mucho y 50 links por cuenta, para que
--     esto no sea una forma de llenar la base saltándose la cuota de la 0008.
--   · Borrar el proyecto borra su link. "Dejar de compartir" lo borra también.
-- ============================================================================


create table if not exists public.shares (
  project_id  uuid primary key references public.projects(id) on delete cascade,
  -- Dos UUID v4 sin guiones: 244 bits al azar, sin depender de pgcrypto.
  token       text not null unique
              default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  user_id     uuid not null default auth.uid(),
  imagen      text not null,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

do $$ begin
  alter table public.shares add constraint shares_imagen_valida
    check (char_length(imagen) <= 1500000
       and (imagen like 'data:image/jpeg;base64,%' or imagen like 'data:image/png;base64,%'));
exception when duplicate_object then null; end $$;

create index if not exists shares_user_id_idx on public.shares(user_id);

alter table public.shares enable row level security;

-- El dueño ve sus links (para saber cuál es) y puede borrarlos. Crear y
-- actualizar va SOLO por la función de abajo.
drop policy if exists shares_select_propios on public.shares;
create policy shares_select_propios on public.shares
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists shares_delete_propios on public.shares;
create policy shares_delete_propios on public.shares
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.shares from anon, authenticated, public;
grant select, delete on public.shares to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Compartir (o refrescar la imagen de un link que ya existe)
-- ────────────────────────────────────────────────────────────────────────────
-- `security definer` porque la tabla no acepta escrituras directas; por eso
-- mismo cada condición se comprueba acá adentro, a mano, contra auth.uid().
-- Volver a compartir el mismo proyecto conserva el token: el link que ya se
-- mandó sigue andando y muestra la imagen nueva.
create or replace function public.compartir_proyecto(p_proyecto uuid, p_imagen text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'Hay que iniciar sesión para compartir' using errcode = '42501';
  end if;
  -- P0002 distinto de "no es tuyo": la app lo usa para avisar que el proyecto
  -- todavía se está subiendo, que es el caso de verdad cuando no aparece.
  if not exists (select 1 from public.projects where id = p_proyecto and user_id = v_uid) then
    raise exception 'El proyecto no está en tu cuenta' using errcode = 'P0002';
  end if;
  if (select count(*) from public.shares where user_id = v_uid and project_id <> p_proyecto) >= 50 then
    raise exception 'Llegaste al máximo de 50 links compartidos' using errcode = 'check_violation';
  end if;

  insert into public.shares (project_id, user_id, imagen)
  values (p_proyecto, v_uid, p_imagen)
  on conflict (project_id) do update
    set imagen = excluded.imagen, actualizado = now()
    where public.shares.user_id = v_uid
  returning token into v_token;
  return v_token;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- Mirar un diseño compartido (sin cuenta)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.ver_compartido(p_token text)
returns table (nombre text, prenda text, imagen text, actualizado timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, p.mockup_id, s.imagen, s.actualizado
    from public.shares s
    join public.projects p on p.id = s.project_id
   where s.token = p_token
     and char_length(p_token) = 64
$$;

-- La 0008 deja toda función nueva sin permisos: se dan solo estos.
revoke execute on function public.compartir_proyecto(uuid, text) from anon, authenticated, public;
grant  execute on function public.compartir_proyecto(uuid, text) to authenticated;
revoke execute on function public.ver_compartido(text) from anon, authenticated, public;
grant  execute on function public.ver_compartido(text) to anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- Esperado: rls_activo = true, politicas = 2, perm_anon = 0, perm_authent = 2
-- (SELECT y DELETE), y las dos funciones con search_path fijo.
select
  c.relrowsecurity                                                    as rls_activo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shares') as politicas,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'shares' and grantee = 'anon')          as perm_anon,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'shares' and grantee = 'authenticated') as perm_authent
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'shares';
