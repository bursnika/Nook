import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGoogleEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  /** Empty or missing clears the description. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  /** For all-day events: midnight UTC of the day after the last day, like Google. */
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsBoolean()
  allDay!: boolean;
}
