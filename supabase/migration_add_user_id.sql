-- Agregar user_id a las tablas existentes
alter table folders  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table projects add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Índices para queries por usuario
create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists folders_user_id_idx  on folders(user_id);
