begin;

alter table public.fci_module_assignments
  drop constraint if exists fci_module_assignments_module_code_check,
  drop constraint if exists fci_module_assignments_assigned_role_check;

alter table public.fci_module_assignments
  add constraint fci_module_assignments_module_code_check
    check (module_code in ('B', 'C', 'D')),
  add constraint fci_module_assignments_assigned_role_check
    check (assigned_role in ('FINANCE', 'OPERATIONS', 'DIRECTION_GENERALE'));

commit;
