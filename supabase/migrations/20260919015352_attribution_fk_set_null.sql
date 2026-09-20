-- Every "who did this" attribution column (registered_by, generated_by,
-- reported_by, etc.) references profiles(id) with no ON DELETE behavior,
-- which defaults to RESTRICT: deleting a user's auth account fails outright
-- the moment they've done anything in the app, since Postgres won't let the
-- profiles row disappear while still referenced. Deleting an account should
-- cascade-delete the user's OWN studies (already correct via owner_id/
-- supervisor_id cascades) but only null out their attribution on records
-- that belong to someone else's data (or survive independently), never
-- block the deletion and never silently destroy those other records.

alter table protocol_versions alter column registered_by drop not null;
alter table protocol_versions drop constraint protocol_versions_registered_by_fkey;
alter table protocol_versions add constraint protocol_versions_registered_by_fkey
  foreign key (registered_by) references profiles(id) on delete set null;

alter table protocol_versions drop constraint protocol_versions_approved_by_fkey;
alter table protocol_versions add constraint protocol_versions_approved_by_fkey
  foreign key (approved_by) references profiles(id) on delete set null;

alter table amendments alter column proposed_by drop not null;
alter table amendments drop constraint amendments_proposed_by_fkey;
alter table amendments add constraint amendments_proposed_by_fkey
  foreign key (proposed_by) references profiles(id) on delete set null;

alter table amendments drop constraint amendments_reviewed_by_fkey;
alter table amendments add constraint amendments_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table milestones drop constraint milestones_updated_by_fkey;
alter table milestones add constraint milestones_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

alter table deviations alter column reported_by drop not null;
alter table deviations drop constraint deviations_reported_by_fkey;
alter table deviations add constraint deviations_reported_by_fkey
  foreign key (reported_by) references profiles(id) on delete set null;

alter table generated_outputs drop constraint generated_outputs_generated_by_fkey;
alter table generated_outputs add constraint generated_outputs_generated_by_fkey
  foreign key (generated_by) references profiles(id) on delete set null;

alter table deviation_reports alter column generated_by drop not null;
alter table deviation_reports drop constraint deviation_reports_generated_by_fkey;
alter table deviation_reports add constraint deviation_reports_generated_by_fkey
  foreign key (generated_by) references profiles(id) on delete set null;

alter table supervisor_invitations alter column invited_by drop not null;
alter table supervisor_invitations drop constraint supervisor_invitations_invited_by_fkey;
alter table supervisor_invitations add constraint supervisor_invitations_invited_by_fkey
  foreign key (invited_by) references profiles(id) on delete set null;
