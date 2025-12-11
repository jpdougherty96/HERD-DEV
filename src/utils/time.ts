import {
  formatDateDisplay,
  formatDateRangeDisplay,
  formatDateRangeShort,
  formatTime,
} from "./formatting";

export {
  formatDateDisplay,
  formatDateRangeDisplay,
  formatDateRangeShort,
  formatTime,
};

export const generateTimeOptions = () => {
  const times: { value: string; display: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const display = formatTime(value);
      times.push({ value, display });
    }
  }
  return times;
};
