-- RAW Design — Schema inicial
-- Ejecutar en Supabase → SQL Editor

create table if not exists folders (
  id          uuid    primary key,
  name        text    not null,
  created_at  bigint  not null
);

create table if not exists projects (
  id          uuid    primary key,
  folder_id   uuid    references folders(id) on delete set null,
  name        text    not null,
  mockup_id   text    not null,
  thumbnail   text,
  canvas_json text,
  colors      text[]  not null default '{}',
  tag         text    not null default '',
  created_at  bigint  not null,
  updated_at  bigint  not null
);

-- Índices para ordenar por fecha
create index if not exists projects_updated_at_idx on projects(updated_at desc);
create index if not exists folders_created_at_idx  on folders(created_at desc);
