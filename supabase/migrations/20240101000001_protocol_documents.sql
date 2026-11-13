-- Registry of ingested SOP documents.
--
-- Chunks live in `protocol_chunks` and reference this table. Keeping the
-- document metadata separate means we can list, tag, and delete documents
-- without touching the (much larger) chunk table.

create table if not exists public.protocol_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text        not null,
  filename      text        not null,
  storage_path  text,
  mime_type     text,
  tags          text[]      not null default '{}',
  chunk_count   integer     not null default 0,
  char_count    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.protocol_documents is
  'Registry of ingested laboratory SOP documents.';

create index if not exists protocol_documents_created_at_idx
  on public.protocol_documents (created_at desc);

-- Keep updated_at honest without requiring a trigger on every write path.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protocol_documents_touch_updated_at on public.protocol_documents;

create trigger protocol_documents_touch_updated_at
  before update on public.protocol_documents
  for each row
  execute function public.touch_updated_at();
