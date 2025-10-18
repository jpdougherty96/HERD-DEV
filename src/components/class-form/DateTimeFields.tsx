import React, { useState } from "react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Clock, CalendarIcon } from "lucide-react";
import { cn } from "../ui/utils";
import { formatTime, generateTimeOptions } from "../../utils/time";

export const DateTimeFields = ({
  date,
  onDateChange,
  time,
  onTimeChange,
  minDate,
}: {
  date: string;
  onDateChange: (d: string) => void;
  time: string;
  onTimeChange: (t: string) => void;
  minDate?: Date;
}) => {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  const stringToDate = (s: string) => {
    if (!s) return undefined;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const selectedDate = stringToDate(date);
  const formatDate = (s: string) => (!s ? "Select a date" : s.split("-").reverse().join("/"));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Start Date */}
      <div>
        <Label className="text-[#2d3d1f]">Start Date</Label>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal mt-1 bg-white text-[#1f2b15]",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              <span>{formatDate(date)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d: Date | undefined) => {
                if (!d) return;
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const da = String(d.getDate()).padStart(2, "0");
                onDateChange(`${y}-${m}-${da}`);
                setCalendarOpen(false);
              }}
              disabled={(d: Date) => !!minDate && d < minDate}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Start Time */}
      <div>
        <Label className="text-[#2d3d1f]">Start Time</Label>
        <Popover open={timeOpen} onOpenChange={setTimeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal mt-1 bg-white text-[#1f2b15]",
                !time && "text-muted-foreground"
              )}
            >
              <Clock className="mr-2 h-4 w-4" />
              <span>{formatTime(time)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="max-h-60 overflow-y-auto grid gap-1 p-2">
              {generateTimeOptions().map((t) => (
                <Button
                  key={t.value}
                  variant={time === t.value ? "default" : "ghost"}
                  className={cn(
                    "justify-start font-normal",
                    time === t.value
                      ? "bg-[#556B2F] text-white hover:bg-[#3c4f21]"
                      : "hover:bg-[#f8f9f6]"
                  )}
                  onClick={() => {
                    onTimeChange(t.value);
                    setTimeOpen(false);
                  }}
                >
                  {t.display}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};
