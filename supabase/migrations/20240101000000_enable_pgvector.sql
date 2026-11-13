-- Enable pgvector for native vector storage and similarity search.
create extension if not exists vector;

-- gen_random_uuid() lives in pgcrypto on older Postgres versions.
create extension if not exists pgcrypto;
