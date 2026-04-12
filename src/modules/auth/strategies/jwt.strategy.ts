import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../../database/entities/user.entity';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private static readonly ALLOWED_AUTH_STATUSES = new Set<UserStatus>([
        UserStatus.ACTIVE,
        UserStatus.LIMITED,
        UserStatus.SHADOW_SUSPENDED,
    ]);

    constructor(
        configService: ConfigService,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly redisService: RedisService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('jwt.secret'),
        });
    }

    async validate(payload: any) {
        // Check if this specific token has been blacklisted (logout / revocation)
        if (payload.jti) {
            const isBlacklisted = await this.redisService.isTokenBlacklisted(payload.jti);
            if (isBlacklisted) {
                throw new UnauthorizedException('Token has been revoked');
            }
        }

        // Check if all sessions were revoked after this token was issued
        const revokedAt = await this.redisService.getUserRevokedAt(payload.sub);
        if (revokedAt && payload.iat && payload.iat * 1000 < revokedAt) {
            throw new UnauthorizedException('Session has been revoked. Please re-login.');
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.sub },
            select: ['id', 'email', 'role', 'status', 'firstName', 'lastName'],
        });

        if (!user || !JwtStrategy.ALLOWED_AUTH_STATUSES.has(user.status)) {
            throw new UnauthorizedException('Invalid or inactive account');
        }

        return {
            sub: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            firstName: user.firstName,
            lastName: user.lastName,
            jti: payload.jti,
            familyId: payload.familyId,
        };
    }
}
