-- A sense may have no fill-in-the-blank frames: for some words (often concrete nouns like
-- "bank") the model keeps putting the word itself in the blank, and those frames are
-- dropped. Such words are still practiced with the usage choice, scenarios and open prompts.
alter table public.senses drop constraint senses_frames_check;
alter table public.senses add constraint senses_frames_check check (cardinality(frames) between 0 and 2);
