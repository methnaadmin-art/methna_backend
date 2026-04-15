import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { Request } from 'express';

@ApiTags('security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('security')
export class SecurityController {
    constructor(private readonly securityService: SecurityService) { }

    // ─── DEVICE MANAGEMENT ──────────────────────────────────

    @Get('devices')
    @ApiOperation({ summary: 'Get all registered devices' })
    async getDevices(@CurrentUser('sub') userId: string) {
        return this.securityService.getUserDevices(userId);
    }

    @Post('devices/register')
    @ApiOperation({ summary: 'Register or refresh the current device (biometric/device trust setup)' })
    async registerDevice(
        @CurrentUser('sub') userId: string,
        @Req() req: Request,
        @Body()
        body: {
            fingerprint: string;
            name?: string;
            platform?: string;
            osVersion?: string;
            appVersion?: string;
            ipAddress?: string;
        },
    ) {
        const device = await this.securityService.registerDevice(userId, {
            fingerprint: body.fingerprint,
            name: body.name,
            platform: body.platform,
            osVersion: body.osVersion,
            appVersion: body.appVersion,
            ipAddress:
                body.ipAddress ||
                req.ip ||
                req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
        });

        return {
            message: 'Device registered successfully',
            device,
        };
    }

    @Delete('devices/:id')
    @ApiOperation({ summary: 'Revoke a device' })
    async revokeDevice(
        @CurrentUser('sub') userId: string,
        @Param('id') deviceId: string,
    ) {
        await this.securityService.revokeDevice(userId, deviceId);
        return { message: 'Device revoked' };
    }

    @Get('login-history')
    @ApiOperation({ summary: 'Get login history' })
    async getLoginHistory(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.securityService.getLoginHistory(userId, limit || 20);
    }

    // ─── ADMIN: EMAIL BLACKLIST ─────────────────────────────

    @Get('admin/blacklist')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get email domain blacklist (admin)' })
    async getBlacklist() {
        return this.securityService.getBlacklist();
    }

    @Post('admin/blacklist')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Add email domain to blacklist (admin)' })
    async addToBlacklist(
        @CurrentUser('sub') adminId: string,
        @Body() body: { domain: string; reason: string },
    ) {
        return this.securityService.addToBlacklist(body.domain, body.reason, adminId);
    }

    @Delete('admin/blacklist/:domain')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Remove email domain from blacklist (admin)' })
    async removeFromBlacklist(@Param('domain') domain: string) {
        await this.securityService.removeFromBlacklist(domain);
        return { message: 'Domain removed from blacklist' };
    }
}
