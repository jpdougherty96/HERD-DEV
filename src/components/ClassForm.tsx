import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { cn } from "./ui/utils";
import { toast } from "sonner";
import type { Class } from "../App";
import { normalizeToCents } from "../utils/money";
import { validateClassForm } from "../utils/validation/classForm";
import { supabaseAdapter } from "../components/shared/PhotoUpload/supabaseAdapter";
import { PhotoUpload } from "../components/shared/PhotoUpload/PhotoUpload";
import { AddressFields } from "../components/shared/AddressFields";
import { DateTimeFields } from "../components/class-form/DateTimeFields";
import { formatDateRangeDisplay } from "../utils/time";

type ClassFormSubmit = Omit<Class, "createdAt" | "instructorId"> & { id?: string };

type ClassFormProps = {
  onSubmit: (classData: ClassFormSubmit) => void;
  onCancel: () => void;
  user: User | null;
  initialData?: Class | null;
  mode?: "create" | "edit" | "relaunch";
};

type User = {
  id: string;
  email: string;
  name: string;
  farmName?: string;
  bio?: string;
  profilePicture?: string;
  location?: string;
  stripeConnected: boolean;
  createdAt: string;
};

type ClassFormState = {
  title: string;
  shortSummary: string;
  startDate: string;
  startTime: string;
  endDate: string;
  numberOfDays: string;
  hoursPerDay: string;
  pricePerPerson: string;
  maxStudents: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  instructorName: string;
  minimumAge: string;
  instructorBio: string;
  advisories: string;
  houseRules: string;
  photos: string[];
  auto_approve: boolean;
  hostId: string;
  host_id: string;
  hostName: string;
};

const computeEndDate = (startDate: string, numberOfDays: string | number): string => {
  if (!startDate) return "";
  const days =
    typeof numberOfDays === "string"
      ? parseInt(numberOfDays, 10)
      : Math.trunc(numberOfDays);
  const totalDays = Number.isFinite(days) && days > 0 ? days : 1;
  const [yearStr, monthStr, dayStr] = startDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return startDate;
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + (totalDays - 1));
  return utcDate.toISOString().slice(0, 10);
};

const buildInitialFormState = (user: User | null, initialData?: Class | null): ClassFormState => {
  const startDate = initialData?.startDate ?? "";
  const numberOfDaysRaw = initialData?.numberOfDays ?? 1;
  const derivedEndDate =
    initialData?.endDate ??
    (startDate ? computeEndDate(startDate, numberOfDaysRaw) : "");

  return {
    title: initialData?.title ?? "",
    shortSummary: initialData?.shortSummary ?? "",
    startDate,
    startTime: initialData?.startTime ?? "",
    endDate: derivedEndDate,
    numberOfDays: String(numberOfDaysRaw ?? 1),
    hoursPerDay: initialData?.hoursPerDay ? String(initialData.hoursPerDay) : "",
    pricePerPerson: initialData?.pricePerPerson
      ? (initialData.pricePerPerson / 100).toFixed(2)
      : "",
    maxStudents: String(initialData?.maxStudents ?? 1),
    address: {
      street: initialData?.address?.street ?? "",
      city: initialData?.address?.city ?? "",
      state: initialData?.address?.state ?? "",
      zipCode: initialData?.address?.zipCode ?? "",
    },
    instructorName: initialData?.instructorName ?? user?.name ?? "",
    minimumAge: String(initialData?.minimumAge ?? 0),
    instructorBio: initialData?.instructorBio ?? user?.bio ?? "",
    advisories: initialData?.advisories ?? "",
    houseRules: initialData?.houseRules ?? "",
    photos: Array.isArray(initialData?.photos) ? initialData!.photos : [],
    auto_approve: initialData?.auto_approve ?? false,
    hostId: initialData?.hostId ?? user?.id ?? "",
    host_id: initialData?.host_id ?? initialData?.hostId ?? user?.id ?? "",
    hostName: initialData?.hostName ?? user?.name ?? "",
  };
};

export function ClassForm({
  onSubmit,
  onCancel,
  user,
  initialData = null,
  mode = "create",
}: ClassFormProps) {
  const isRelaunch = mode === "relaunch";
  const [formData, setFormData] = useState<ClassFormState>(() =>
    buildInitialFormState(user, initialData)
  );
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    setFormData(buildInitialFormState(user, initialData));
  }, [initialData, user?.id, user?.name, user?.bio]);

  const handleChange = (field: keyof ClassFormState, value: any) =>
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "startDate" || field === "numberOfDays") {
        next.endDate = computeEndDate(next.startDate, next.numberOfDays);
      }
      return next;
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return toast.info("Please wait for photos to finish uploading.");

    const validationError = validateClassForm(formData, {
      requireFutureDate: isRelaunch,
    });
    if (validationError) return toast.warning(validationError);

    const numberOfDays = Number(formData.numberOfDays);
    const maxStudents = Number(formData.maxStudents);
    const pricePerPersonCents = normalizeToCents(formData.pricePerPerson.trim());
    const minimumAge = Number(formData.minimumAge || 0);
    const endDate = formData.endDate || (formData.startDate ? computeEndDate(formData.startDate, formData.numberOfDays) : "");

    const payload: ClassFormSubmit = {
      ...formData,
      endDate,
      numberOfDays,
      hoursPerDay: formData.hoursPerDay ? Number(formData.hoursPerDay) : undefined,
      maxStudents,
      pricePerPerson: pricePerPersonCents,
      minimumAge,
    };

    if (mode === "edit" && initialData?.id) {
      payload.id = initialData.id;
    }

    onSubmit(payload);
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minSelectableDate = mode === "edit" ? undefined : tomorrow;

  const adapter = supabaseAdapter({
    bucket: "class-photos",
    prefix: formData.hostId || user?.id || "anonymous",
  });

  // unified margin style
  const baseFieldClasses = "mt-1 w-full";


  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card className="bg-white border-[#a8b892] shadow-lg">
        <CardHeader className="bg-[#556B2F] text-[#f8f9f6] rounded-t-lg">
          <CardTitle className="text-2xl text-white">
            {mode === "edit"
              ? "Edit Class"
              : isRelaunch
                ? "Relaunch Class"
                : "Create a Class"}
          </CardTitle>
          <p className="text-[#a8b892]">
            {mode === "edit"
              ? "Update your class details to keep students informed."
              : isRelaunch
                ? "We copied your class details—set a new future date before relaunching."
                : "Share your homesteading knowledge with the community"}
          </p>
        </CardHeader>

        <CardContent className="p-6">
          {isRelaunch && (
            <div className="mb-6 rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
              Choose a new future start date and time before submitting to relaunch this class.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <Label htmlFor="title" className="text-[#2d3d1f]">Title</Label>
              <Input
                id="title"
                type="text"
                value={formData.title}
                onChange={(e) => handleChange("title", e.target.value)}
                required
                className={baseFieldClasses}
                placeholder="e.g., Intro to Permaculture"
              />
            </div>

            {/* Summary */}
            <div>
              <Label htmlFor="shortSummary">Description (max 500 characters)</Label>
              <Textarea
                id="shortSummary"
                value={formData.shortSummary}
                onChange={(e) => handleChange("shortSummary", e.target.value)}
                maxLength={500}
                required
                className={baseFieldClasses}
                placeholder="What will students learn in this class?"
              />
              <p className="text-sm text-[#3c4f21] mt-1">
                {formData.shortSummary.length}/500 characters
              </p>
            </div>

            {/* Date & Time Fields */}
            <DateTimeFields
              date={formData.startDate}
              onDateChange={(d) => handleChange("startDate", d)}
              time={formData.startTime}
              onTimeChange={(t) => handleChange("startTime", t)}
              minDate={minSelectableDate}
            />
            {formData.startDate && formData.endDate && (
              <p className="text-sm text-[#556B2F]">
                Your class runs from {formatDateRangeDisplay(formData.startDate, formData.endDate)}.
              </p>
            )}

            {/* Duration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="numberOfDays">Number of Days</Label>
                <Input
                  id="numberOfDays"
                  type="number"
                  min="1"
                  value={formData.numberOfDays}
                  onChange={(e) => handleChange("numberOfDays", e.target.value)}
                  required
                  className={baseFieldClasses}
                />
              </div>
              <div>
                <Label htmlFor="hoursPerDay">Hours per Day (optional)</Label>
                <Input
                  id="hoursPerDay"
                  type="number"
                  min="1"
                  max="12"
                  step="0.5"
                  value={formData.hoursPerDay}
                  onChange={(e) => handleChange("hoursPerDay", e.target.value)}
                  className={baseFieldClasses}
                  placeholder="e.g., 4"
                />
              </div>
            </div>

            {/* Price & Students */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="pricePerPerson">Price per Person (USD)</Label>
                <Input
                  id="pricePerPerson"
                  type="number"
                  step="0.01"
                  value={formData.pricePerPerson}
                  onChange={(e) => handleChange("pricePerPerson", e.target.value)}
                  required
                  className={baseFieldClasses}
                />
              </div>
              <div>
                <Label htmlFor="maxStudents">Max Students</Label>
                <Input
                  id="maxStudents"
                  type="number"
                  min="1"
                  value={formData.maxStudents}
                  onChange={(e) => handleChange("maxStudents", e.target.value)}
                  required
                  className={baseFieldClasses}
                />
              </div>
            </div>

            {/* Address Fields */}
            <div>
              <Label className="text-[#2d3d1f] mb-3 block">Class Location</Label>
              <p className="text-sm text-[#556B2F] mb-3 italic">
                Only city and state will be shown publicly. Full address is shared with confirmed students.
              </p>
              <AddressFields
                value={formData.address}
                onChange={(val) => handleChange("address", val)}
              />
            </div>

            {/* Instructor Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="instructorName">Instructor Name</Label>
                <Input
                  id="instructorName"
                  value={formData.instructorName}
                  onChange={(e) => handleChange("instructorName", e.target.value)}
                  required
                  className={baseFieldClasses}
                />
              </div>
              <div>
                <Label htmlFor="minimumAge">Minimum Age</Label>
                <Input
                  id="minimumAge"
                  type="number"
                  min="0"
                  value={formData.minimumAge}
                  onChange={(e) => handleChange("minimumAge", e.target.value)}
                  className={baseFieldClasses}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="instructorBio">Instructor Bio</Label>
              <Textarea
                id="instructorBio"
                value={formData.instructorBio}
                onChange={(e) => handleChange("instructorBio", e.target.value)}
                className={baseFieldClasses}
              />
            </div>

            {/* Advisories & House Rules */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="advisories">Advisories</Label>
                <Textarea
                  id="advisories"
                  value={formData.advisories}
                  onChange={(e) => handleChange("advisories", e.target.value)}
                  className={baseFieldClasses}
                />
              </div>
              <div>
                <Label htmlFor="houseRules">House Rules</Label>
                <Textarea
                  id="houseRules"
                  value={formData.houseRules}
                  onChange={(e) => handleChange("houseRules", e.target.value)}
                  className={baseFieldClasses}
                />
              </div>
            </div>

            {/* Photo Upload */}
            <PhotoUpload
              value={formData.photos}
              onChange={(photos) => handleChange("photos", photos)}
              adapter={adapter}
              maxPhotos={8}
            />

            {/* Booking Settings */}
            <div className="border-t border-[#a8b892] pt-6">
              <Label className="mb-4 block">Booking Settings</Label>
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="auto_approve"
                  checked={formData.auto_approve}
                  onCheckedChange={(checked) =>
                    handleChange("auto_approve", checked === true)
                  }
                  className="mt-1 border border-black data-[state=checked]:bg-[#556B2F]"
                />
                <div className="space-y-1 text-sm text-[#556B2F]">
                  <p>
                    <strong>When enabled:</strong> Students book instantly with automatic confirmation.
                  </p>
                  <p>
                    <strong>When disabled:</strong> You must manually approve or decline bookings.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-[#a8b892]">
              <Button
                type="submit"
                className="flex-1 bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
                disabled={isUploading}
              >
                {mode === "edit" ? "Save Changes" : "Create Class"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="flex-1 border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
