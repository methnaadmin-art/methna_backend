import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlansService } from '../../modules/plans/plans.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { PlanEntitlements } from '../../database/entities/plan.entity';

/**
 * Guard that checks if the authenticated user's plan includes the required feature.
 * Place @RequireFeature('invisibleMode') on a route, then add this guard.
 */
@Injectable()
export class RequireFeatureGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly plansService: PlansService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredFeature = this.reflector.get<keyof PlanEntitlements>(
            REQUIRE_FEATURE_KEY,
            context.getHandler(),
        );

        if (!requiredFeature) return true;

        const request = context.switchToHttp().getRequest();
        const userId = request.user?.sub || request.user?.id;

        if (!userId) throw new ForbiddenException('Not authenticated');

        const hasAccess = await this.plansService.hasFeature(userId, requiredFeature);
        if (!hasAccess) {
            throw new ForbiddenException(
                `Feature '${requiredFeature}' is not available on your current plan`,
            );
        }

        return true;
    }
}
