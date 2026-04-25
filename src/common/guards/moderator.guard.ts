import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { hasModeratorAccess } from '../auth/user-role.util';

@Injectable()
export class ModeratorGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        return hasModeratorAccess(request?.user?.role);
    }
}
