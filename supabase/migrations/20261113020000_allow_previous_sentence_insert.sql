-- Captures are inserted with column grants; the extension now sends previous_sentence too.
grant insert (previous_sentence) on public.captures to authenticated;
