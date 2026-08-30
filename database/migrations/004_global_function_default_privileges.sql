set local role tge_owner;

alter default privileges for role tge_owner
  revoke execute on functions from public;

revoke execute on all functions in schema tge from public;
