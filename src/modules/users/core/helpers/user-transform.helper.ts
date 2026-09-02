import { User, Biodata } from '@prisma/client';
import { UserEntity } from '../entities/user.entity';

type UserWithRelations = User & {
  biodata?: Biodata | null;
};

export class UserTransformHelper {
  static toEntity(user: UserWithRelations): UserEntity {
    return new UserEntity({
      id: user.id,
      email: user.email,
      biodata: user.biodata || undefined,
      created_at: user.created_at,
      updated_at: user.updated_at,
      deleted_at: user.deleted_at,
    });
  }

  static toEntities(users: UserWithRelations[]): UserEntity[] {
    return users.map((user) => this.toEntity(user));
  }
}
