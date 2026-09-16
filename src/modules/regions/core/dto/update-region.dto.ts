import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRegionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
