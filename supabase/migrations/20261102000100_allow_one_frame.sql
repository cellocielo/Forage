-- Enrichment asks for three frames and keeps up to two that leave the word visible
-- (prompt enrich-v5); a sense may end up with just one.
alter table public.senses drop constraint senses_frames_check;
alter table public.senses add constraint senses_frames_check check (cardinality(frames) between 1 and 2);
