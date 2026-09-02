import { Role } from '@prisma/client';

export interface JwtPayload {
  userId: number;
  email: string;
  role: Role;
  first_name?: string;
  last_name?: string;
}
