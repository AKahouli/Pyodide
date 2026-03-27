/**
 * UsersPage - User management with listing, filtering, and actions
 */

import { useEffect, useState, useCallback } from 'react';
import { Users, Loader2, AlertCircle, RefreshCw, Search, UserX, UserCheck, Shield, CreditCard, ChevronLeft, ChevronRight, MoreHorizontal, Mail, MailCheck, CheckCircle2, XCircle, X, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { getAdminUsers, suspendUser, activateUser, assignPlanToUser, getAllPlans, getActiveRoles, assignRoleToUser, unassignRoleFromUser } from '../api';
import type { AdminUserResponse, AdminUserListParams, UserStatus, PlanResponse, RoleResponse } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

const STATUS_LABEL_KEYS: Record<UserStatus, ModuleTranslationKey<'admin'>> = {
  active: 'users.status.active',
  suspended: 'users.status.suspended',
  inactive: 'users.status.inactive',
};

function formatDateLocalized(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelativeTimeLocalized(dateString: string | undefined, translate: AdminTranslate, locale: string): string {
  if (!dateString) return translate('users.dates.never');
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return translate('users.dates.today');
  if (diffDays === 1) return translate('users.dates.yesterday');
  if (diffDays < 7) return translate('users.dates.daysAgo', { count: diffDays });
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return translate('users.dates.weeksAgo', { count: weeks });
  }
  return formatDateLocalized(dateString, locale);
}

function getDisplayName(user: AdminUserResponse): string {
  if (user.profile.firstName || user.profile.lastName) {
    return `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim();
  }
  return user.email.split('@')[0];
}

function renderStatusBadge(status: UserStatus, translate: AdminTranslate) {
  const label = translate(STATUS_LABEL_KEYS[status]);
  switch (status) {
    case 'active':
      return (
        <Badge variant='default' className='bg-green-500'>
          {label}
        </Badge>
      );
    case 'suspended':
      return <Badge variant='destructive'>{label}</Badge>;
    case 'inactive':
      return <Badge variant='secondary'>{label}</Badge>;
    default:
      return <Badge variant='outline'>{label}</Badge>;
  }
}

export function UsersPage() {
  const { t, language } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [emailVerifiedFilter, setEmailVerifiedFilter] = useState<'all' | 'true' | 'false'>('all');

  // Data for modals
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [roles, setRoles] = useState<RoleResponse[]>([]);

  // Modal states
  const [selectedUser, setSelectedUser] = useState<AdminUserResponse | null>(null);
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [showRolesDialog, setShowRolesDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  // Plan assignment state
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

  // Role management state
  const [userRoles, setUserRoles] = useState<Set<string>>(new Set());

  const formatRelativeTime = useCallback((dateString?: string) => formatRelativeTimeLocalized(dateString, t, language), [t, language]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params: AdminUserListParams = {
        page,
        limit,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (emailVerifiedFilter !== 'all') params.emailVerified = emailVerifiedFilter === 'true';

      const data = await getAdminUsers(params);
      setUsers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('users.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, emailVerifiedFilter]);

  const fetchPlansAndRoles = async () => {
    try {
      const [plansData, rolesData] = await Promise.all([getAllPlans(), getActiveRoles()]);
      setPlans(plansData.filter((p) => p.isActive));
      setRoles(rolesData);
    } catch (err) {
      console.error('Failed to load plans/roles', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchPlansAndRoles();
  }, []);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatusFilter('all');
    setEmailVerifiedFilter('all');
    setPage(1);
  };

  const openSuspendDialog = (user: AdminUserResponse) => {
    setSelectedUser(user);
    setShowSuspendDialog(true);
  };

  const openActivateDialog = (user: AdminUserResponse) => {
    setSelectedUser(user);
    setShowActivateDialog(true);
  };

  const openPlanDialog = (user: AdminUserResponse) => {
    setSelectedUser(user);
    setSelectedPlanId(user.plan?.id || '');
    setShowPlanDialog(true);
  };

  const openRolesDialog = (user: AdminUserResponse) => {
    setSelectedUser(user);
    setUserRoles(new Set(user.roles.map((r) => r.id)));
    setShowRolesDialog(true);
  };

  const handleSuspend = async () => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      await suspendUser(selectedUser.id);
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, status: 'suspended' as UserStatus } : u)));
      toast.success(t('users.toasts.suspend.title'), {
        description: t('users.toasts.suspend.description', { email: selectedUser.email }),
      });
      setShowSuspendDialog(false);
    } catch (err) {
      toast.error(t('users.toasts.suspend.error'), {
        description: err instanceof Error ? err.message : t('users.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      await activateUser(selectedUser.id);
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, status: 'active' as UserStatus } : u)));
      toast.success(t('users.toasts.activate.title'), {
        description: t('users.toasts.activate.description', { email: selectedUser.email }),
      });
      setShowActivateDialog(false);
    } catch (err) {
      toast.error(t('users.toasts.activate.error'), {
        description: err instanceof Error ? err.message : t('users.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignPlan = async () => {
    if (!selectedUser || !selectedPlanId) return;
    setSaving(true);

    try {
      const updated = await assignPlanToUser(selectedUser.id, { planId: selectedPlanId });
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? updated : u)));
      toast.success(t('users.toasts.planAssigned.title'), {
        description: t('users.toasts.planAssigned.description', { email: selectedUser.email }),
      });
      setShowPlanDialog(false);
    } catch (err) {
      toast.error(t('users.toasts.planAssigned.error'), {
        description: err instanceof Error ? err.message : t('users.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRole = async (roleId: string, roleName: string, assign: boolean) => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      if (assign) {
        await assignRoleToUser({ userId: selectedUser.id, roleId });
        setUserRoles((prev) => new Set([...prev, roleId]));
        setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, roles: [...u.roles, { id: roleId, name: roleName }] } : u)));
        toast.success(t('users.toasts.roleAssigned.title'), {
          description: t('users.toasts.roleAssigned.description', { role: roleName, email: selectedUser.email }),
        });
      } else {
        await unassignRoleFromUser({ userId: selectedUser.id, roleId });
        setUserRoles((prev) => {
          const next = new Set(prev);
          next.delete(roleId);
          return next;
        });
        setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, roles: u.roles.filter((r) => r.id !== roleId) } : u)));
        toast.success(t('users.toasts.roleRemoved.title'), {
          description: t('users.toasts.roleRemoved.description', { role: roleName, email: selectedUser.email }),
        });
      }
    } catch (err) {
      toast.error(assign ? t('users.toasts.roleAssigned.error') : t('users.toasts.roleRemoved.error'), {
        description: err instanceof Error ? err.message : t('users.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const hasActiveFilters = search || statusFilter !== 'all' || emailVerifiedFilter !== 'all';

  if (error && !loading) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={fetchUsers} variant='outline'>
          <RefreshCw className='mr-2 h-4 w-4' />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t('users.title')}</h1>
          <p className='text-muted-foreground'>{t('users.description')}</p>
        </div>
        <Button onClick={fetchUsers} variant='outline' size='icon' aria-label={t('users.actions.refresh')}>
          <RefreshCw className='h-4 w-4' />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className='pt-6'>
          <div className='flex flex-col gap-4 md:flex-row md:items-end'>
            <div className='flex-1'>
              <Label htmlFor='search' className='sr-only'>
                {t('users.filters.searchLabel')}
              </Label>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                <Input id='search' placeholder={t('users.filters.searchPlaceholder')} className='pl-9' value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={handleSearchKeyDown} />
              </div>
            </div>
            <div className='flex gap-2 flex-wrap'>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as UserStatus | 'all');
                  setPage(1);
                }}>
                <SelectTrigger className='w-[130px]'>
                  <SelectValue placeholder={t('users.filters.status.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('users.filters.status.all')}</SelectItem>
                  <SelectItem value='active'>{t('users.filters.status.active')}</SelectItem>
                  <SelectItem value='suspended'>{t('users.filters.status.suspended')}</SelectItem>
                  <SelectItem value='inactive'>{t('users.filters.status.inactive')}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={emailVerifiedFilter}
                onValueChange={(value) => {
                  setEmailVerifiedFilter(value as 'all' | 'true' | 'false');
                  setPage(1);
                }}>
                <SelectTrigger className='w-[140px]'>
                  <SelectValue placeholder={t('users.filters.email.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('users.filters.email.all')}</SelectItem>
                  <SelectItem value='true'>{t('users.filters.email.verified')}</SelectItem>
                  <SelectItem value='false'>{t('users.filters.email.unverified')}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleSearch}>{t('users.filters.search')}</Button>
              {hasActiveFilters && (
                <Button variant='ghost' onClick={clearFilters}>
                  <X className='mr-1 h-4 w-4' />
                  {t('users.filters.clear')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
              <Users className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('users.table.title')}</CardTitle>
              <CardDescription>{loading ? t('users.table.loading') : t('users.table.total', { count: total })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('users.table.columns.user')}</TableHead>
                  <TableHead className='hidden md:table-cell'>{t('users.table.columns.status')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>{t('users.table.columns.plan')}</TableHead>
                  <TableHead className='hidden xl:table-cell'>{t('users.table.columns.roles')}</TableHead>
                  <TableHead className='hidden xl:table-cell'>{t('users.table.columns.lastLogin')}</TableHead>
                  <TableHead className='text-right'>{t('users.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className='h-24 text-center'>
                      <Loader2 className='h-6 w-6 animate-spin mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className='h-24 text-center'>
                      {t('users.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className='flex flex-col'>
                          <div className='flex items-center gap-2'>
                            <span className='font-medium'>{getDisplayName(user)}</span>
                            {user.emailVerified ? <MailCheck className='h-4 w-4 text-green-500' /> : <Mail className='h-4 w-4 text-muted-foreground' />}
                          </div>
                          <span className='text-xs text-muted-foreground'>{user.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className='hidden md:table-cell'>
                        <div className='flex flex-col gap-1'>
                          {renderStatusBadge(user.status, t)}
                          {user.profileComplete ? (
                            <span className='text-xs text-green-600 flex items-center gap-1'>
                              <CheckCircle2 className='h-3 w-3' /> {t('users.profile.complete')}
                            </span>
                          ) : (
                            <span className='text-xs text-muted-foreground flex items-center gap-1'>
                              <XCircle className='h-3 w-3' /> {t('users.profile.incomplete')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='hidden lg:table-cell'>{user.plan ? <Badge variant='outline'>{user.plan.slug}</Badge> : <span className='text-muted-foreground text-sm'>{t('users.plan.none')}</span>}</TableCell>
                      <TableCell className='hidden xl:table-cell'>
                        <div className='flex flex-wrap gap-1 max-w-[150px]'>
                          {user.roles.length === 0 ? (
                            <span className='text-muted-foreground text-sm'>{t('users.roles.none')}</span>
                          ) : (
                            <>
                              {user.roles.slice(0, 2).map((role) => (
                                <Badge key={role.id} variant='secondary' className='text-xs'>
                                  {role.name}
                                </Badge>
                              ))}
                              {user.roles.length > 2 && (
                                <Badge variant='secondary' className='text-xs'>
                                  {t('users.roles.more', { count: user.roles.length - 2 })}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='hidden xl:table-cell'>
                        <span className='text-sm text-muted-foreground'>{formatRelativeTime(user.lastLoginAt)}</span>
                      </TableCell>
                      <TableCell className='text-right'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon'>
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuLabel>{t('users.dropdown.label')}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openPlanDialog(user)}>
                              <CreditCard className='mr-2 h-4 w-4' />
                              {t('users.dropdown.assignPlan')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openRolesDialog(user)}>
                              <Shield className='mr-2 h-4 w-4' />
                              {t('users.dropdown.manageRoles')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {user.status === 'suspended' ? (
                              <DropdownMenuItem onClick={() => openActivateDialog(user)}>
                                <UserCheck className='mr-2 h-4 w-4' />
                                {t('users.dropdown.activate')}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => openSuspendDialog(user)} className='text-destructive'>
                                <UserX className='mr-2 h-4 w-4' />
                                {t('users.dropdown.suspend')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-2 py-4'>
              <p className='text-sm text-muted-foreground'>{t('users.pagination.summary', { page, total: totalPages })}</p>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className='h-4 w-4' />
                  {t('users.pagination.previous')}
                </Button>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  {t('users.pagination.next')}
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspend Dialog */}
      <AlertDialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.modals.suspend.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('users.modals.suspend.description', { email: selectedUser?.email ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSuspend} disabled={saving} className='bg-destructive hover:bg-destructive/90'>
              {saving ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('users.modals.suspend.loading')}
                </>
              ) : (
                t('users.modals.suspend.action')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activate Dialog */}
      <AlertDialog open={showActivateDialog} onOpenChange={setShowActivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.modals.activate.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('users.modals.activate.description', { email: selectedUser?.email ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivate} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('users.modals.activate.loading')}
                </>
              ) : (
                t('users.modals.activate.action')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Plan Dialog */}
      <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.modals.plan.title')}</DialogTitle>
            <DialogDescription>{t('users.modals.plan.description', { email: selectedUser?.email ?? '' })}</DialogDescription>
          </DialogHeader>
          <div className='py-4'>
            <Label htmlFor='plan'>{t('users.plan.label')}</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger className='mt-2'>
                <SelectValue placeholder={t('users.plan.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    <div className='flex items-center gap-2'>
                      <span>{plan.name}</span>
                      {plan.isDefault && (
                        <Badge variant='secondary' className='text-xs'>
                          {t('users.plan.defaultBadge')}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setShowPlanDialog(false)} disabled={saving}>
              {tCommon('actionCancel')}
            </Button>
            <Button onClick={handleAssignPlan} disabled={saving || !selectedPlanId}>
              {saving ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('users.modals.plan.loading')}
                </>
              ) : (
                t('users.modals.plan.action')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Roles Dialog */}
      <Dialog open={showRolesDialog} onOpenChange={setShowRolesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.modals.roles.title')}</DialogTitle>
            <DialogDescription>{t('users.modals.roles.description', { email: selectedUser?.email ?? '' })}</DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-3 max-h-64 overflow-y-auto'>
            {roles.map((role) => {
              const hasRole = userRoles.has(role.id);
              return (
                <div key={role.id} className='flex items-center justify-between p-3 rounded-lg border'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium'>{role.name}</span>
                      <Badge variant='outline' className='text-xs'>
                        {t('users.roles.priority', { value: role.priority })}
                      </Badge>
                    </div>
                    <p className='text-xs text-muted-foreground line-clamp-1'>{role.description}</p>
                  </div>
                  <Checkbox checked={hasRole} disabled={saving} onCheckedChange={(checked) => handleToggleRole(role.id, role.name, checked as boolean)} />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRolesDialog(false)}>{t('users.roles.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
