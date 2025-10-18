export const formatTime = (time: string) => {
  if (!time) return "Select time";
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
};

export const generateTimeOptions = () => {
  const times: { value: string; display: string }[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 30) {
    const v = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    times.push({ value: v, display: formatTime(v) });
  }
  return times;
};
