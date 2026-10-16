import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

/** The visible window of the calendar: events overlapping it and tasks due inside it. */
export class CalendarRangeQuery {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;
}
