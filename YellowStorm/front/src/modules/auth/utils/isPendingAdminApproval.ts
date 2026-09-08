export function isPendingAdminApproval(user: { status?: string } | null | undefined): boolean {
  return user?.status === 'inactive';
}

