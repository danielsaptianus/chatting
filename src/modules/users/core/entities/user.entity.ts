import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User as PrismaUser, Biodata } from '@prisma/client';
import { Exclude } from 'class-transformer';

export class UserEntity implements Partial<PrismaUser> {
  @ApiProperty()
  id: number;

  @ApiProperty()
  email: string;

  @Exclude()
  password: string;

  @ApiPropertyOptional()
  biodata?: Partial<Biodata>;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  @ApiPropertyOptional()
  deleted_at: Date | null;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
