import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUpdatePolicy } from '../../database/entities/app-update-policy.entity';

type SupportedPlatform = 'android' | 'ios';

type UpdatePolicyPatch = Partial<
    Pick<
        AppUpdatePolicy,
        | 'isActive'
        | 'minimumSupportedVersion'
        | 'latestVersion'
        | 'title'
        | 'hardUpdateMessage'
        | 'softUpdateMessage'
        | 'storeUrlAndroid'
        | 'storeUrliOS'
    >
>;

@Injectable()
export class AppUpdatePolicyService {
    constructor(
        @InjectRepository(AppUpdatePolicy)
        private readonly policyRepository: Repository<AppUpdatePolicy>,
    ) {}

    async getPolicy(): Promise<AppUpdatePolicy> {
        const existing = await this.findLatestPolicy();

        return existing ?? this.policyRepository.create(this.defaultPolicy());
    }

    async updatePolicy(patch: UpdatePolicyPatch, adminId?: string): Promise<AppUpdatePolicy> {
        const existing = await this.findLatestPolicy();

        const target = existing ?? this.policyRepository.create(this.defaultPolicy());
        const normalizedPatch = {
            ...patch,
            ...(patch.storeUrliOS !== undefined
                ? { storeUrliOS: this.normalizeIosStoreUrl(patch.storeUrliOS) }
                : {}),
        };
        const merged = this.policyRepository.merge(target, {
            ...normalizedPatch,
            updatedById: adminId ?? target.updatedById ?? null,
        });

        return this.policyRepository.save(merged);
    }

    async getMobilePolicy(input: {
        platform?: string;
        version?: string;
    }) {
        const policy = await this.getPolicy();
        const platform = this.normalizePlatform(input.platform);
        const currentVersion = input.version?.trim() || '';
        const minimumSupportedVersion = policy.minimumSupportedVersion?.trim() || '';
        const latestVersion = policy.latestVersion?.trim() || '';
        const iosStoreUrl = this.normalizeIosStoreUrl(policy.storeUrliOS);
        const androidStoreUrl = policy.storeUrlAndroid?.trim() || null;
        const storeUrl = platform === 'ios' ? iosStoreUrl : androidStoreUrl;
        const canOpenStore = platform !== 'ios' || !!iosStoreUrl;

        const hardRequired =
            policy.isActive &&
            canOpenStore &&
            minimumSupportedVersion.length > 0 &&
            currentVersion.length > 0 &&
            this.compareVersions(currentVersion, minimumSupportedVersion) < 0;

        const softUpdateAvailable =
            policy.isActive &&
            canOpenStore &&
            latestVersion.length > 0 &&
            currentVersion.length > 0 &&
            this.compareVersions(currentVersion, latestVersion) < 0;

        return {
            isActive: policy.isActive,
            platform,
            currentVersion,
            minimumSupportedVersion: minimumSupportedVersion || null,
            latestVersion: latestVersion || null,
            hardRequired,
            softUpdateAvailable: !hardRequired && softUpdateAvailable,
            title: policy.title?.trim() || 'Update available',
            message: hardRequired
                ? (policy.hardUpdateMessage?.trim() || 'Please update Methna to continue.')
                : (policy.softUpdateMessage?.trim() || 'A newer version of Methna is available.'),
            hardUpdateMessage: policy.hardUpdateMessage?.trim() || null,
            softUpdateMessage: policy.softUpdateMessage?.trim() || null,
            storeUrl,
            storeUrlAndroid: androidStoreUrl,
            storeUrliOS: iosStoreUrl,
            updatedAt: policy.updatedAt ?? null,
        };
    }

    private async findLatestPolicy(): Promise<AppUpdatePolicy | null> {
        const [policy] = await this.policyRepository.find({
            order: { updatedAt: 'DESC', createdAt: 'DESC' },
            take: 1,
        });

        return policy ?? null;
    }

    private defaultPolicy(): Partial<AppUpdatePolicy> {
        return {
            isActive: false,
            minimumSupportedVersion: null,
            latestVersion: null,
            title: 'Update available',
            hardUpdateMessage: 'Please update Methna to continue.',
            softUpdateMessage: 'A newer version of Methna is available.',
            storeUrlAndroid:
                'https://play.google.com/store/apps/details?id=com.methnapp.app',
            storeUrliOS: process.env.IOS_APP_STORE_URL?.trim() || null,
        };
    }

    private normalizePlatform(platform?: string): SupportedPlatform {
        const normalized = platform?.trim().toLowerCase();
        return normalized === 'ios' ? 'ios' : 'android';
    }

    private normalizeIosStoreUrl(value?: string | null): string | null {
        const url = value?.trim() || '';
        if (!url || url.includes('id0000000000')) {
            return null;
        }
        return url;
    }

    private compareVersions(left: string, right: string): number {
        const leftParts = this.parseVersion(left);
        const rightParts = this.parseVersion(right);
        const length = Math.max(leftParts.length, rightParts.length);

        for (let index = 0; index < length; index += 1) {
            const leftPart = leftParts[index] ?? 0;
            const rightPart = rightParts[index] ?? 0;
            if (leftPart > rightPart) return 1;
            if (leftPart < rightPart) return -1;
        }

        return 0;
    }

    private parseVersion(value: string): number[] {
        return value
            .split('+')
            [0]
            .split('.')
            .map((part) => parseInt(part.replace(/[^0-9]/g, ''), 10))
            .map((part) => (Number.isFinite(part) ? part : 0));
    }
}
