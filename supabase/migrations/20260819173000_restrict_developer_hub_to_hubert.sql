-- Developer Hub is intentionally restricted to Hubert Sadecki only.
delete from public.developer_accounts
where user_id <> 'ad8895d0-3fb6-453e-96a0-51ba835d7158';

insert into public.developer_accounts(user_id, role, enabled, granted_by)
values (
  'ad8895d0-3fb6-453e-96a0-51ba835d7158',
  'developer',
  true,
  '8b298b36-09c7-4d2e-be8b-e8500a307f25'
)
on conflict (user_id) do update
set role = 'developer',
    enabled = true,
    granted_by = excluded.granted_by;
