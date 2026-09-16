import { IsInt, IsNotEmpty } from 'class-validator';

export class AssignRegionAdminDto {
  @IsNotEmpty({ message: 'admin_id wajib diisi' })
  @IsInt()
  admin_id: number;
}
