import type { UserRole } from "../auth/rbac.ts";

export const DEPARTMENT_CODES = [
  "COMMERCIAL",
  "FINANCE",
  "OPERATIONS",
  "DIRECTION_GENERALE",
  "ADMINISTRATION"
] as const;

export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

export type DepartmentRecord = {
  code: DepartmentCode;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export const USER_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "INVITED",
  "LOCKED"
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export type UserRecord = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  normalizedEmail: string;
  jobTitle: string;
  departmentCode: DepartmentCode;
  departmentName: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type UserListFilters = {
  search?: string;
  role?: UserRole | "all";
  department?: DepartmentCode | "all";
  status?: UserStatus | "all";
};

export type UserMutationInput = {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  departmentCode: DepartmentCode;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  phone: string | null;
  language: string;
  timezone: string;
};

export type ProfileUpdateInput = {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  departmentCode: DepartmentCode;
  avatarUrl: string | null;
  phone: string | null;
  language: string;
  timezone: string;
};

export type DevelopmentUserOption = Pick<
  UserRecord,
  "id" | "displayName" | "email" | "departmentCode" | "departmentName" | "role" | "status"
>;

export type DevelopmentUserState = {
  currentUserId: number;
  users: DevelopmentUserOption[];
};
