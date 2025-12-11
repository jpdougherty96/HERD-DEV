import React, { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { Calendar, Clock, Users, ArrowLeft } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import type { Class, Page, User } from "../types/domain";
import {
  formatDateRangeDisplay,
  formatPrice,
  formatTime,
} from "@/utils/formatting";
import { resolvePriceCentsFromRow } from "../utils/money";

type HostProfilePageProps = {
  hostId: string;
  currentUser: User | null;
  onNavigate: (page: Page) => void;
  onSelectClass: (classData: Class) => void;
};

type HostProfile = {
  id: string;
  full_name: string;
  farm_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};

function formatClassDates(startDate?: string, endDate?: string) {
  const label = formatDateRangeDisplay(startDate, endDate);
  return label || "Date TBD";
}

function resolveInstructorName(row: any, host: HostProfile | null) {
  const candidates = [
    typeof row?.instructor_name === "string" ? row.instructor_name : "",
    typeof row?.host_name === "string" ? row.host_name : "",
    typeof host?.full_name === "string" ? host.full_name : "",
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) return candidate.trim();
  }
  return host?.full_name ?? "Instructor";
}

function resolveHoursPerDay(value: any): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 24) return null;
  return numeric;
}

function mapRowToClass(row: any, hostProfile: HostProfile | null): Class {
  const instructorName = resolveInstructorName(row, hostProfile);
  const hostProfileData = row?.host_profile ?? hostProfile ?? null;

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
    hostName: instructorName,
    instructorId: row.host_id,
    minimumAge: row.minimum_age ?? 0,
    instructorBio: row.instructor_bio ?? "",
    instructorAvatar: hostProfileData?.avatar_url ?? null,
    advisories: row.advisories ?? "",
    houseRules: row.house_rules ?? "",
    photos: row.photos ?? [],
    auto_approve: !!row.auto_approve,
    createdAt: row.created_at ?? new Date().toISOString(),
    hostProfile: hostProfileData
      ? {
          fullName: hostProfileData.full_name ?? "",
          farmName: hostProfileData.farm_name ?? "",
          bio: hostProfileData.bio ?? "",
          avatarUrl: hostProfileData.avatar_url ?? null,
        }
      : null,
  };
}

function getInitials(name?: string | null) {
  if (!name) return "??";
  const parts = name.trim().split(" ");
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "??";
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function HostProfilePage({
  hostId,
  currentUser,
  onNavigate,
  onSelectClass,
}: HostProfilePageProps) {
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null);
  const [hostAvatarUrl, setHostAvatarUrl] = useState<string | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, farm_name, bio, avatar_url")
          .eq("id", hostId)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!profileData) {
          throw new Error("Host profile not found.");
        }

        if (!cancelled) {
          setHostProfile(profileData);
        }

        const avatarPath = profileData.avatar_url;
        if (avatarPath) {
          if (/^https?:\/\//i.test(avatarPath)) {
            if (!cancelled) setHostAvatarUrl(avatarPath);
          } else {
            const { data: signed, error: signedError } = await supabase.storage
              .from("avatars")
              .createSignedUrl(avatarPath, 60 * 60 * 24 * 7);
            if (signedError) {
              console.error("Failed to create signed avatar URL:", signedError.message ?? signedError);
              if (!cancelled) setHostAvatarUrl(null);
            } else if (!cancelled) {
              setHostAvatarUrl(signed?.signedUrl ?? null);
            }
          }
        } else if (!cancelled) {
          setHostAvatarUrl(null);
        }

        const todayIso = new Date().toISOString().split("T")[0];
        const { data: classesData, error: classesError } = await supabase
          .from("classes")
          .select(`
            *,
            host_profile:profiles!classes_host_id_fkey(full_name, farm_name, bio, avatar_url)
          `)
          .eq("host_id", hostId)
          .gte("start_date", todayIso)
          .order("start_date", { ascending: true });

        if (classesError) throw classesError;

        const mapped = (classesData ?? []).map((row) => mapRowToClass(row, profileData));
        if (!cancelled) {
          setClasses(mapped);
        }
      } catch (err: any) {
        console.error("Failed to load host profile:", err?.message || err);
        if (!cancelled) {
          setError(err?.message || "Unable to load host profile right now.");
          setClasses([]);
          setHostProfile(null);
          setHostAvatarUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [hostId]);

  const upcomingClasses = useMemo(
    () =>
      classes.slice().sort((a, b) => {
        const aDate = new Date(`${a.startDate}T${a.startTime || "00:00"}`).getTime();
        const bDate = new Date(`${b.startDate}T${b.startTime || "00:00"}`).getTime();
        return aDate - bDate;
      }),
    [classes]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9f6] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
          <p className="text-[#556B2F]">Loading host profile...</p>
        </div>
      </div>
    );
  }

  if (error || !hostProfile) {
    return (
      <div className="min-h-screen bg-[#f8f9f6] flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-[#c54a2c]">
          <CardHeader>
            <CardTitle className="text-[#c54a2c]">Host Not Available</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[#3c4f21]">
            <p>{error ?? "We could not find details for this host."}</p>
            <Button onClick={() => onNavigate("classes")} className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]">
              Return to Classes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => onNavigate("classes")}
            className="text-[#556B2F] hover:bg-[#e8e9e6] hover:text-[#3c4f21]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Classes
          </Button>
          {currentUser?.id === hostProfile.id && (
            <Button
              variant="outline"
              onClick={() => onNavigate("dashboard")}
              className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
            >
              Manage Classes
            </Button>
          )}
        </div>

        <Card className="border-[#a8b892] bg-white">
          <CardContent className="flex flex-col items-center text-center py-10 px-6 space-y-4">
            {hostAvatarUrl ? (
              <ImageWithFallback
                src={hostAvatarUrl}
                alt={`${hostProfile.full_name} avatar`}
                className="w-20 h-20 rounded-full object-cover border-2 border-[#a8b892] shadow"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-[#e8e9e6] flex items-center justify-center text-xl font-semibold text-[#556B2F] border-2 border-[#a8b892] shadow">
                {getInitials(hostProfile.full_name)}
              </div>
            )}
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[#2d3d1f]">{hostProfile.full_name}</h1>
              {hostProfile.farm_name && (
                <p className="text-[#556B2F] font-medium">{hostProfile.farm_name}</p>
              )}
            </div>
            {hostProfile.bio && (
              <p className="text-[#3c4f21] max-w-2xl leading-relaxed">{hostProfile.bio}</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[#2d3d1f]">Classes Offered</h2>
            <span className="text-sm text-[#556B2F]">
              {upcomingClasses.length} upcoming class{upcomingClasses.length === 1 ? "" : "es"}
            </span>
          </div>

          {upcomingClasses.length === 0 ? (
            <Card className="border-dashed border-2 border-[#a8b892] bg-white">
              <CardContent className="py-12 text-center space-y-2">
                <h3 className="text-lg text-[#2d3d1f] font-medium">No upcoming classes yet</h3>
                <p className="text-[#556B2F] text-sm">
                  Check back soon to see new sessions from {hostProfile.full_name.split(" ")[0] ?? "this host"}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingClasses.map((cls) => (
                <Card
                  key={cls.id}
                  className="border-[#a8b892] bg-white hover:shadow-lg transition-shadow cursor-pointer flex flex-col"
                  onClick={() => onSelectClass(cls)}
                >
                  {cls.photos && cls.photos.length > 0 ? (
                    <ImageWithFallback
                      src={cls.photos[0]}
                      alt={cls.title}
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="h-40 w-full bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center">
                      <div className="text-center text-[#556B2F]">
                        <span className="block text-sm opacity-70">No photo available</span>
                      </div>
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg text-[#2d3d1f]">{cls.title}</CardTitle>
                    <p className="text-sm text-[#556B2F] line-clamp-2">{cls.shortSummary}</p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[#3c4f21] flex-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#556B2F]" />
                      <span>{formatClassDates(cls.startDate, cls.endDate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#556B2F]" />
                      <span>
                        {cls.startTime ? formatTime(cls.startTime) : `${cls.numberOfDays} day${cls.numberOfDays > 1 ? "s" : ""}`}
                        {cls.hoursPerDay ? ` • ${cls.hoursPerDay} hour${cls.hoursPerDay > 1 ? "s" : ""}/day` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#556B2F]" />
                      <span>Maximum {cls.maxStudents} students</span>
                    </div>
                  </CardContent>
                  <div className="px-6 pb-6">
                    <Button className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]">
                      View Class • {formatPrice(cls.pricePerPerson, { withCurrency: true })}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
