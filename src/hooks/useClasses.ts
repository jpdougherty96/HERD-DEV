import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { resolvePriceCentsFromRow } from "@/utils/money";
import type { Class, User } from "@/types/domain";

export function resolveHostName(row: any): string {
  const hostProfile =
    row?.host_profile ??
    row?.profiles ??
    row?.profile ??
    row?.hostProfile ??
    null;

  const candidates = [
    row?.instructor_name,
    row?.host_name,
    row?.hostName,
    hostProfile?.full_name,
    hostProfile?.name,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

export function resolveHoursPerDay(value: any): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 24) return null;
  return numeric;
}

export function mapClassRowToUI(row: any): Class {
  const hostName = resolveHostName(row);
  const instructorNameRaw =
    typeof row?.instructor_name === "string" ? row.instructor_name.trim() : "";
  const instructorName = instructorNameRaw || hostName || "";
  const hostProfile =
    row?.host_profile ??
    row?.profiles ??
    row?.profile ??
    row?.hostProfile ??
    null;
  const ratingAverageRaw =
    hostProfile?.rating_average ??
    hostProfile?.ratingAverage ??
    row?.rating_average ??
    null;
  const ratingCountRaw =
    hostProfile?.rating_count ??
    hostProfile?.ratingCount ??
    row?.rating_count ??
    null;
  const ratingAverage =
    ratingAverageRaw === null ||
    ratingAverageRaw === undefined ||
    ratingAverageRaw === ""
      ? null
      : Number(ratingAverageRaw);
  const ratingCount =
    ratingCountRaw === null ||
    ratingCountRaw === undefined ||
    ratingCountRaw === ""
      ? 0
      : Number(ratingCountRaw);
  return {
    id: row.id,
    title: row.title,
    shortSummary: row.short_summary ?? "",
    startDate: row.start_date ?? "",
    startTime: row.start_time ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    numberOfDays: row.number_of_days ?? 1,
    hoursPerDay: resolveHoursPerDay(row.hours_per_day),
    pricePerPerson: resolvePriceCentsFromRow(row),
    maxStudents: row.max_students ?? 0,
    address: {
      street: row.address_street ?? "",
      city: row.address_city ?? "",
      state: row.address_state ?? "",
      zipCode: row.address_zip ?? "",
      country: row.address_country ?? "",
    },
    instructorName,
    hostId: row.host_id,
    host_id: row.host_id,
    hostName: hostName || instructorName,
    instructorId: row.host_id,
    minimumAge: row.minimum_age ?? 0,
    instructorBio: row.instructor_bio ?? "",
    instructorAvatar: hostProfile?.avatar_url ?? null,
    advisories: row.advisories ?? "",
    houseRules: row.house_rules ?? "",
    photos: row.photos ?? [],
    auto_approve: !!row.auto_approve,
    createdAt: row.created_at ?? new Date().toISOString(),
    hostRatingAverage: Number.isFinite(ratingAverage) ? ratingAverage : null,
    hostRatingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
    hostProfile: {
      fullName: hostProfile?.full_name ?? "",
      farmName: hostProfile?.farm_name ?? "",
      bio: hostProfile?.bio ?? "",
      avatarUrl: hostProfile?.avatar_url ?? null,
      ratingAverage: Number.isFinite(ratingAverage) ? ratingAverage : null,
      ratingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
    },
  };
}

export function applyInstructorFallback(
  cls: Class,
  currentUser?: User | null,
): Class {
  const trimmedInstructorName = (cls.instructorName ?? "").trim();
  const trimmedHostName = (cls.hostName ?? "").trim();

  if (trimmedInstructorName && trimmedHostName) {
    return cls;
  }

  const fallbackName =
    trimmedInstructorName ||
    trimmedHostName ||
    (currentUser && cls.instructorId === currentUser.id
      ? currentUser.name
      : "");

  if (!fallbackName) {
    return cls;
  }

  return {
    ...cls,
    instructorName: trimmedInstructorName || fallbackName,
    hostName: trimmedHostName || fallbackName,
  };
}

export function useClasses(currentUser?: User | null) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadClassesFromServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: supabaseError } = await supabase
        .from("classes")
        .select(
          `
          *,
          host_profile:profiles!classes_host_id_fkey(full_name, avatar_url, farm_name, bio, rating_average, rating_count)
        `,
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (supabaseError) throw supabaseError;
      const normalized = (data ?? [])
        .map(mapClassRowToUI)
        .map((cls) => applyInstructorFallback(cls, currentUser));
      setClasses(normalized);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadClassesFromServer();
  }, [loadClassesFromServer]);

  return { classes, setClasses, loading, error, refresh: loadClassesFromServer };
}
