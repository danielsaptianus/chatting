import { Role } from '@prisma/client';

export interface JwtPayload {
  userId: number;
  email: string;
  role: Role;
  region_id?: number | null;
  managed_region_id?: number | null;
  managed_group_id?: number | null;
  first_name?: string;
  last_name?: string;
}
