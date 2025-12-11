import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { X, Users, DollarSign, Calendar, Clock, MapPin, AlertTriangle } from 'lucide-react';
import type { Class, User } from '../App';
import { supabase } from '../utils/supabaseClient';
import { normalizeToCents } from '../utils/money';
import { formatDateRangeDisplay, formatTime as formatTimeDisplay } from "@/utils/formatting";

async function startPayment(classId: string, userId: string, qty: number, studentNames: string[]) {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: {
      class_id: classId,
      user_id: userId,
      qty,
      student_names: studentNames,
    },
  });

  if (error) {
    throw new Error(error.message || 'Could not start checkout');
  }

  const url = (data as { url?: string } | null)?.url;
  if (!url) {
    throw new Error('Checkout URL missing from response');
  }

  window.location.href = url;
}

type BookingModalProps = {
  classData: Class;
  user: User;
  onClose: () => void;
  onBookingSuccess: () => void;
  initialAvailableSpots?: number | null;
};

export function BookingModal({ classData, user, onClose, onBookingSuccess, initialAvailableSpots }: BookingModalProps) {
  const [numberOfStudents, setNumberOfStudents] = useState(1);
  const [studentNames, setStudentNames] = useState<string[]>(['']);
  const [liabilityAccepted, setLiabilityAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableSeats, setAvailableSeats] = useState<number | null>(
    typeof initialAvailableSpots === 'number' ? Math.max(0, initialAvailableSpots) : null
  );
  const [loadingSeats, setLoadingSeats] = useState(false);

  // ---- MONEY ----
  const herdFeePercentage = 8;
  const unitCents = normalizeToCents(classData.pricePerPerson);
  const subtotalCents = unitCents * numberOfStudents;
  const herdFeeCents = Math.round(subtotalCents * (herdFeePercentage / 100));
  const totalCents = subtotalCents + herdFeeCents;
  const fmt = (cents: number) => (Number(cents || 0) / 100).toFixed(2);

  const seatsRemaining = (() => {
    const seats = availableSeats;
    if (typeof seats === 'number') {
      return Math.max(0, Math.min(seats, classData.maxStudents));
    }
    return classData.maxStudents;
  })();

  const hasAvailability = seatsRemaining > 0;

  const syncStudentNames = (count: number) => {
    setStudentNames((prev) => {
      const names = [...prev];
      while (names.length < count) names.push('');
      while (names.length > count) names.pop();
      return names;
    });
  };

  const handleStudentCountChange = (count: number) => {
    if (!hasAvailability) return;
    const clamped = Math.max(1, Math.min(count, seatsRemaining));
    setNumberOfStudents(clamped);
    syncStudentNames(clamped);
  };

  useEffect(() => {
    if (availableSeats == null) return;
    if (!hasAvailability) {
      setNumberOfStudents(1);
      syncStudentNames(1);
      return;
    }
    setNumberOfStudents((prev) => {
      const clamped = Math.max(1, Math.min(prev, seatsRemaining));
      if (clamped !== prev) {
        syncStudentNames(clamped);
      }
      return clamped;
    });
  }, [availableSeats, hasAvailability, seatsRemaining]);

  useEffect(() => {
    let cancelled = false;
    const fetchSeats = async () => {
      try {
        setLoadingSeats(true);
        const { data, error: rpcError } = await supabase.rpc('available_spots', { class_uuid: classData.id });
        if (!cancelled) {
          if (rpcError) {
            console.warn('Failed to load available spots:', rpcError);
            setAvailableSeats(null);
          } else {
            setAvailableSeats(typeof data === 'number' ? Math.max(0, data) : null);
          }
        }
      } catch (rpcErr) {
        if (!cancelled) {
          console.warn('Failed to load available spots:', rpcErr);
          setAvailableSeats(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingSeats(false);
        }
      }
    };
    void fetchSeats();
    return () => {
      cancelled = true;
    };
  }, [classData.id]);

  const handleStudentNameChange = (index: number, name: string) => {
    const newNames = [...studentNames];
    newNames[index] = name;
    setStudentNames(newNames);
  };

  const isFormValid = () =>
    hasAvailability &&
    numberOfStudents > 0 &&
    numberOfStudents <= seatsRemaining &&
    studentNames.every((name) => name.trim().length > 0) &&
    liabilityAccepted;

  const handleSubmitBooking = async () => {
    if (!isFormValid()) return;

    setLoading(true);
    setError(null);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) throw new Error('Authentication required. Please sign in again.');

      const userId = session.user.id;
      const normalizedNames = studentNames.map((name) => name.trim()).filter(Boolean).slice(0, numberOfStudents);

      if (!hasAvailability) {
        setError('This class is fully booked.');
        return;
      }

      if (numberOfStudents > seatsRemaining) {
        setError(seatsRemaining === 1 ? 'Only 1 seat remains for this class.' : `Only ${seatsRemaining} seats remain for this class.`);
        return;
      }

      await startPayment(classData.id, userId, numberOfStudents, normalizedNames);
    } catch (err: any) {
      console.error('Booking error:', err);
      setError(err?.message || 'An error occurred while starting your checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="bg-[#ffffff] border-[#a8b892] max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl mb-2 text-[#f8f9f6]">Book: {classData.title}</CardTitle>
              <p className="text-[#a8b892]">with {classData.instructorName}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-[#f8f9f6] hover:bg-[#6B7F3F]"><X className="w-4 h-4" /></Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Class Summary */}
          <div className="bg-[#f8f9f6] rounded-lg p-4 space-y-2">
            <h4 className="font-semibold text-[#2d3d1f] mb-3">Class Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#556B2F]" />
                <span>{formatDateRangeDisplay(classData.startDate, classData.endDate)}</span>
              </div>
              {classData.startTime && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#556B2F]" />
                  <span>{formatTimeDisplay(classData.startTime)}</span>
                </div>
              )}
              <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-[#556B2F]" /><span>${fmt(unitCents)} per person</span></div>
              <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-[#556B2F]" /><span>{classData.address.city}, {classData.address.state}</span></div>
            </div>
          </div>

          {/* Student Information */}
          <div className="space-y-4">
            <h4 className="font-semibold text-[#2d3d1f]">Student Information</h4>
            <div>
              <Label htmlFor="studentCount">Number of Students</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => handleStudentCountChange(numberOfStudents - 1)} disabled={!hasAvailability || numberOfStudents <= 1} className="w-8 h-8 p-0">-</Button>
                <Input
                  id="studentCount"
                  type="number"
                  min="1"
                  max={Math.max(1, seatsRemaining)}
                  value={numberOfStudents}
                  onChange={(e) => handleStudentCountChange(parseInt(e.target.value) || 1)}
                  className="w-20 text-center"
                  disabled={!hasAvailability}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => handleStudentCountChange(numberOfStudents + 1)} disabled={!hasAvailability || numberOfStudents >= seatsRemaining} className="w-8 h-8 p-0">+</Button>
                <span className="text-sm text-[#556B2F] ml-2">
                  {loadingSeats
                    ? 'Checking availability...'
                    : hasAvailability
                      ? (seatsRemaining === 1 ? 'Only 1 seat left' : `${seatsRemaining} seats left`)
                      : 'No seats remaining'}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <Label>Student Names</Label>
              {studentNames.map((name, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#556B2F]" />
                  <Input placeholder={`Student ${index + 1} name`} value={name} onChange={(e) => handleStudentNameChange(index, e.target.value)} className="flex-1" required />
                </div>
              ))}
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="space-y-3">
            <h4 className="font-semibold text-[#2d3d1f]">Cost Breakdown</h4>
            <div className="bg-[#f8f9f6] rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>Class fee ({numberOfStudents} × ${fmt(unitCents)})</span><span>${fmt(subtotalCents)}</span></div>
              <div className="flex justify-between text-sm"><span>HERD service fee ({herdFeePercentage}%)</span><span>${fmt(herdFeeCents)}</span></div>
              <div className="border-t border-[#a8b892] pt-2 flex justify-between font-semibold"><span>Total</span><span>${fmt(totalCents)}</span></div>
            </div>
          </div>

          {/* Liability Waiver */}
          <div className="space-y-3">
            <h4 className="font-semibold text-[#2d3d1f]">Liability Agreement</h4>
            <div className="bg-[#fff8e1] border border-[#f9cc33] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#f39c12] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="liability"
                      checked={liabilityAccepted}
                      onCheckedChange={(checked: boolean | "indeterminate") =>
                        setLiabilityAccepted(checked === true)
                      }
                      className="mt-1"
                    />
                    <Label htmlFor="liability" className="text-sm cursor-pointer">
                      By checking this box, I acknowledge that I understand the risks involved in this homesteading class and release both HERD and the class host from any liability for injuries or damages that may occur during the class activities. I participate at my own risk and agree to follow all safety instructions provided by the host.
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4"><p className="text-red-800 text-sm">{error}</p></div>}

          <div className="pt-4 border-t border-[#a8b892]">
            <Button onClick={handleSubmitBooking} disabled={!isFormValid() || loading} className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]" size="lg">
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Processing...
                </div>
              ) : classData.auto_approve ? (
                  `Book Now - $${fmt(totalCents)}`
                ) : (
                  `Request Booking - $${fmt(totalCents)}`
                )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
