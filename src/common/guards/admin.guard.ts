import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { isAdminRole } from '../auth/user-role.util';

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        return isAdminRole(request?.user?.role);
    }
}
