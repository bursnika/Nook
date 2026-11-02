import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class CalendarRangeQuery {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;
}
