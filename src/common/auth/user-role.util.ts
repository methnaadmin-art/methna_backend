import { UserRole } from '../../database/entities/user.entity';

export const ACCEPTED_USER_ROLE_INPUTS = [
    UserRole.ADMIN,
    UserRole.MODERATOR,
    UserRole.USER,
    'staff',
] as const;

export type AcceptedUserRoleInput = (typeof ACCEPTED_USER_ROLE_INPUTS)[number];

export function normalizeUserRoleInput(value: unknown): UserRole | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return undefined;
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }

    if (normalized === 'staff') {
        return UserRole.MODERATOR;
    }

    if (Object.values(UserRole).includes(normalized as UserRole)) {
        return normalized as UserRole;
    }

    return undefined;
}

export function isAdminRole(value: unknown): boolean {
    return normalizeUserRoleInput(value) === UserRole.ADMIN;
}

export function hasModeratorAccess(value: unknown): boolean {
    const normalizedRole = normalizeUserRoleInput(value);
    return normalizedRole === UserRole.ADMIN || normalizedRole === UserRole.MODERATOR;
}
