import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
export function MiniCalendar({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const selected = parseISO(date);
  const first = startOfWeek(startOfMonth(selected), { weekStartsOn: 1 });
  const count =
    Math.ceil(
      (endOfMonth(selected).getTime() - first.getTime()) / 86400000 / 7,
    ) * 7;
  return (
    <section className="mini-calendar">
      <div className="section-heading">
        <strong>{format(selected, "MMMM yyyy")}</strong>
        <div>
          <button
            aria-label="Previous month"
            className="icon-button"
            onClick={() =>
              onChange(format(addMonths(selected, -1), "yyyy-MM-dd"))
            }
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="Next month"
            className="icon-button"
            onClick={() =>
              onChange(format(addMonths(selected, 1), "yyyy-MM-dd"))
            }
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {"MTWTFSS".split("").map((d, i) => (
          <span key={i}>{d}</span>
        ))}
        {Array.from({ length: count }, (_, i) => addDays(first, i)).map((d) => {
          const key = format(d, "yyyy-MM-dd");
          return (
            <button
              key={key}
              aria-label={format(d, "EEEE, MMMM d, yyyy")}
              aria-pressed={key === date}
              className={`${key === date ? "active" : ""} ${d.getMonth() !== selected.getMonth() ? "outside" : ""}`}
              onClick={() => onChange(key)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}
