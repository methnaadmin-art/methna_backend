import { SetMetadata } from '@nestjs/common';
import { PlanEntitlements } from '../../database/entities/plan.entity';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

/**
 * Decorator to enforce feature gating on API routes.
 * Usage: @RequireFeature('invisibleMode') or @RequireFeature('dailyLikes')
 *
 * The RequireFeatureGuard will check the user's entitlements
 * and block access if the feature is not enabled for their plan.
 */
export const RequireFeature = (feature: keyof PlanEntitlements) =>
    SetMetadata(REQUIRE_FEATURE_KEY, feature);
