import "server-only";
import type { UserRole } from "@/lib/db/types";

// ── Permission types ──────────────────────────────────────────────────────────

export type Permission =
  // Admin
  | "admin:read_tenants"
  | "admin:manage_tenants"
  | "admin:read_users"
  | "admin:manage_users"
  | "admin:read_audit"
  | "admin:read_health"
  | "admin:export_data"
  | "admin:manage_settings"
  // Planning
  | "planning:read_scenarios"
  | "planning:manage_scenarios"
  | "planning:read_projects"
  | "planning:manage_projects"
  // Assets
  | "assets:read"
  | "assets:manage"
  // Accounts (CRM)
  | "accounts:read"
  | "accounts:manage"
  | "revenue:read"
  | "revenue:manage"
  // General
  | "data:export"
  | "settings:read"
  | "settings:manage";

// ── Role to permissions mapping ────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    // All permissions
    "admin:read_tenants",
    "admin:manage_tenants",
    "admin:read_users",
    "admin:manage_users",
    "admin:read_audit",
    "admin:read_health",
    "admin:export_data",
    "admin:manage_settings",
    "planning:read_scenarios",
    "planning:manage_scenarios",
    "planning:read_projects",
    "planning:manage_projects",
    "assets:read",
    "assets:manage",
    "accounts:read",
    "accounts:manage",
    "revenue:read",
    "revenue:manage",
    "data:export",
    "settings:read",
    "settings:manage",
  ],
  utility_executive: [
    // Read-only admin access
    "admin:read_tenants",
    "admin:read_users",
    "admin:read_audit",
    "admin:read_health",
    "planning:read_scenarios",
    "planning:manage_scenarios",
    "planning:read_projects",
    "planning:manage_projects",
    "assets:read",
    "assets:manage",
    "accounts:read",
    "accounts:manage",
    "revenue:read",
    "revenue:manage",
    "data:export",
    "settings:read",
    "settings:manage",
  ],
  planner: [
    // Planning and scenario access
    "planning:read_scenarios",
    "planning:manage_scenarios",
    "planning:read_projects",
    "planning:manage_projects",
    "assets:read",
    "revenue:read",
    "data:export",
    "settings:read",
  ],
  engineer: [
    // Asset and infrastructure access
    "assets:read",
    "assets:manage",
    "planning:read_projects",
    "planning:read_scenarios",
    "revenue:read",
    "data:export",
    "settings:read",
  ],
  sales: [
    // CRM and revenue access
    "accounts:read",
    "accounts:manage",
    "revenue:read",
    "revenue:manage",
    "planning:read_scenarios",
    "data:export",
    "settings:read",
  ],
  read_only: [
    // Read-only across all modules
    "admin:read_tenants",
    "admin:read_users",
    "admin:read_audit",
    "planning:read_scenarios",
    "planning:read_projects",
    "assets:read",
    "accounts:read",
    "revenue:read",
    "data:export",
    "settings:read",
  ],
};

// ── Permission checking ───────────────────────────────────────────────────────

/**
 * Check if a role has a specific permission.
 * Returns true if the role has the permission.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Check if a role has one of multiple permissions (OR logic).
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Check if a role has all of multiple permissions (AND logic).
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Require a specific role (super_admin only use case).
 */
export function requireRole(requiredRole: UserRole, actualRole: UserRole): boolean {
  return actualRole === requiredRole;
}

/**
 * Require super_admin role.
 */
export function requireSuperAdmin(role: UserRole): boolean {
  return role === "super_admin";
}

/**
 * Require at least one of specified roles.
 */
export function requireRoles(requiredRoles: UserRole[], actualRole: UserRole): boolean {
  return requiredRoles.includes(actualRole);
}
