/**
 * Permission checking hook
 * Mirrors backend permission logic with deep wildcard matching
 */

import { useMemo, useCallback } from 'react';
import { useAuth } from '@/modules/auth';

/**
 * Check if user has a specific permission
 * Supports deep wildcard matching (e.g., "admin.*" matches "admin.roles.read")
 */
function checkPermission(userPermissions: string[], required: string): boolean {
  // Super admin has all permissions
  if (userPermissions.includes('*')) return true;

  // Exact match
  if (userPermissions.includes(required)) return true;

  // Deep wildcard matching
  // e.g., if required is "admin.roles.read", check for "admin.*"
  const parts = required.split('.');
  for (let i = 1; i < parts.length; i++) {
    const wildcardPath = parts.slice(0, i).join('.') + '.*';
    if (userPermissions.includes(wildcardPath)) return true;
  }

  return false;
}

/**
 * Check if user has any of the specified permissions
 */
function checkAnyPermission(userPermissions: string[], required: string[]): boolean {
  return required.some((perm) => checkPermission(userPermissions, perm));
}

/**
 * Check if user has all of the specified permissions
 */
function checkAllPermissions(userPermissions: string[], required: string[]): boolean {
  return required.every((perm) => checkPermission(userPermissions, perm));
}

export function usePermissions() {
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);

  const hasPermission = useCallback(
    (required: string): boolean => {
      return checkPermission(permissions, required);
    },
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (required: string[]): boolean => {
      return checkAnyPermission(permissions, required);
    },
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (required: string[]): boolean => {
      return checkAllPermissions(permissions, required);
    },
    [permissions]
  );

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
}
