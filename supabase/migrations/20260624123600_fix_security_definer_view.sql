-- Migration: Fix Supabase Security Definer View Warning
-- Timestamp: 20260624123600
-- Description: Convert public.ghl_locations view to security_invoker = true to enforce RLS and resolve Supabase Security Advisor warning.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM pg_class c 
    JOIN pg_namespace n ON n.oid = c.relnamespace 
    WHERE n.nspname = 'public' 
      AND c.relname = 'ghl_locations' 
      AND c.relkind = 'v'
  ) THEN
    ALTER VIEW public.ghl_locations SET (security_invoker = true);
    RAISE NOTICE 'Successfully set security_invoker = true on public.ghl_locations';
  ELSE
    RAISE NOTICE 'View public.ghl_locations does not exist, skipping alter';
  END IF;
END $$;
