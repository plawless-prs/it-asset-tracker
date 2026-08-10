-- 18: Batch-reminder recipients (scheduling calendar feature).
--
-- A daily Vercel cron (12:00 UTC = 7am CDT / 6am CST) calls
-- /api/priceupdates/reminders, which emails one digest listing every batch
-- whose effective_date is within the next 7 days (or past) and that isn't
-- applied/archived yet — repeating daily until each batch is applied or
-- deleted. Recipients live here (editable on the Settings page); an empty
-- array disables sending. Idempotent.

alter table pu_settings add column if not exists reminder_emails text[] not null default '{}';

update pu_settings
   set reminder_emails = array['plawless@powerandrubber.com']
 where id = 1 and reminder_emails = '{}';
