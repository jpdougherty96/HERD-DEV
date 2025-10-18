-- HERD bulletin enhancement: add category column to posts

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'General Discussion';

UPDATE public.posts
SET category = COALESCE(NULLIF(category, ''), 'General Discussion')
WHERE category IS NULL OR category = '';
