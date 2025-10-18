import { normalizeToCents } from "../money";

type ValidationOptions = {
  requireFutureDate?: boolean;
};

export const validateClassForm = (
  form: any,
  options: ValidationOptions = {}
): string | null => {
  const { requireFutureDate = false } = options;

  if (!form.startDate) return "Please select a start date.";
  if (!form.startTime) return "Please select a start time.";

  if (requireFutureDate) {
    const parts = String(form.startDate ?? "").split("-");
    if (parts.length !== 3) return "Please select a valid start date.";

    const [yearStr, monthStr, dayStr] = parts;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return "Please select a valid start date.";
    }

    const startDateValue = new Date(year, month - 1, day);
    startDateValue.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDateValue <= today) {
      return "Start date must be in the future.";
    }
  }

  if (Number(form.numberOfDays) < 1) return "Number of days must be at least 1.";
  if (Number(form.maxStudents) < 1) return "Maximum students must be at least 1.";
  if (!form.address?.street || !form.address.city || !form.address.state || !form.address.zipCode)
    return "Please fill in all address fields.";
  if (normalizeToCents(form.pricePerPerson) <= 0)
    return "Please enter a valid price.";
  return null;
};
