set local role tge_owner;

alter table tge.tasks
  drop constraint tasks_status_check;

alter table tge.tasks
  add constraint tasks_status_check
  check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));
