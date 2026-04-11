import { SetMetadata } from '@nestjs/common';
import { MODERATION_KEY } from '../guards/moderation.guard';

export type ModerationLevelType = 'none' | 'limited' | 'suspended' | 'banned';

/**
 * Set the moderation level required for a route.
 * - 'none'       → only BANNED users blocked
 * - 'limited'    → LIMITED, SUSPENDED, SHADOW_SUSPENDED, BANNED blocked
 * - 'suspended'  → SUSPENDED, BANNED blocked (LIMITED allowed)
 * - 'banned'     → only BANNED blocked
 *
 * Usage: @SetModerationLevel('suspended')
 */
export const SetModerationLevel = (level: ModerationLevelType) =>
    SetMetadata(MODERATION_KEY, level);
