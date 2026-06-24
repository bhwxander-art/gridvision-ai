import type { UserRole } from "@/lib/db/types";

// ── Role constants (no server-only — safe to import from client components) ───

export const USER_ROLES: readonly UserRole[] = [
  "super_admin",
  "utility_executive",
  "planner",
  "engineer",
  "sales",
  "read_only",
] as const;

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       "Super Admin",
  utility_executive: "Utility Executive",
  planner:           "Planner",
  engineer:          "Engineer",
  sales:             "Sales",
  read_only:         "Read Only",
};

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin:       ["read:all", "write:all", "admin:tenants", "admin:users"],
  utility_executive: ["read:all"],
  planner:           ["read:all", "write:planning", "write:scenarios"],
  engineer:          ["read:all", "write:assets"],
  sales:             ["read:all", "write:accounts", "write:revenue"],
  read_only:         ["read:all"],
};
