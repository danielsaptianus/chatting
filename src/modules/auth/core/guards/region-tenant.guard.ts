import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class RegionTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true;
    }

    const userRole = user.biodata?.role || user.role;
    if (userRole === Role.SUPER_ADMIN) {
      return true; // Super Admin has global bypass
    }

    const userRegionId = user.region_id;
    const targetRegionId =
      request.params.regionId ||
      request.params.region_id ||
      request.query.regionId ||
      request.query.region_id ||
      request.body?.region_id ||
      request.body?.regionId;

    if (targetRegionId && userRegionId) {
      if (Number(targetRegionId) !== Number(userRegionId)) {
        throw new ForbiddenException(
          'Akses ditolak: Anda tidak memiliki akses ke Region lain (FR-AUTH-02, NFR-SEC-01)',
        );
      }
    }

    return true;
  }
}
