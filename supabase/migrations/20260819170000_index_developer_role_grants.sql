-- Cover the administrator reference used when developer access is reviewed or revoked.
create index if not exists developer_accounts_granted_by_idx
  on public.developer_accounts(granted_by);
