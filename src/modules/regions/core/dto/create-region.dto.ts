import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRegionDto {
  @IsNotEmpty({ message: 'Nama region tidak boleh kosong' })
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNotEmpty({ message: 'Kode region tidak boleh kosong' })
  @IsString()
  @MaxLength(20)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
