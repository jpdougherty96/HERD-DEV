import React, { useState, useEffect, useMemo } from 'react';
import type { User, Class, Page } from '../App';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Input } from './ui/input';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  DollarSign,
  Phone,
  Edit,
  Trash2,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertCircle,
  Image as ImageIcon
} from 'lucide-react';
import { BroadcastMessageModal } from './BroadcastMessageModal';
import { formatDateRangeShort, formatPrice, formatTime } from '@/utils/formatting';
import { supabase } from '../utils/supabaseClient';
import { toast } from 'sonner@2.0.3';

interface Booking {
  id: string;
  classId: string;
  userId: string;
  userEmail: string;
  userName: string;
  hostId: string;
  hostEmail: string;
  hostName: string;
  studentCount: number;
  studentNames: string[];
  totalAmount: number;
  subtotal: number;
  herdFee: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'FAILED' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'HELD' | 'PAID';
  createdAt: string;
  autoApprove: boolean;
  approved_at?: string;
  denied_at?: string;
  host_message?: string;
  stripePaymentIntentId?: string;
}

interface ClassManagementProps {
  classData: Class;
  user: User;
  onNavigate: (page: Page) => void;
  onDeleteClass: (classId: string) => Promise<void>;
  onEditClass: (classData: Class) => void;
  onUpdateClass: (
    classId: string,
    updates: Partial<Class>,
    options?: {
      minimumMaxStudents?: number;
      hasApprovedBookings?: boolean;
      successMessage?: string;
    }
  ) => Promise<boolean>;
}

export function ClassManagement({ classData, user, onNavigate, onDeleteClass, onEditClass, onUpdateClass }: ClassManagementProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [denialMessage, setDenialMessage] = useState('');
  const [isEditingCapacity, setIsEditingCapacity] = useState(false);
  const [capacityInput, setCapacityInput] = useState<string>(() => String(classData.maxStudents));
  const [isSavingCapacity, setIsSavingCapacity] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);

  const classEndTimestamp = useMemo(() => {
    const dateStr = classData.endDate || classData.startDate;
    if (!dateStr) return null;
    const end = new Date(`${dateStr}T${classData.startTime || '00:00'}`);
    if (Number.isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }, [classData.endDate, classData.startDate, classData.startTime]);

  const isPastClass = classEndTimestamp !== null && classEndTimestamp < Date.now();

  useEffect(() => {
    fetchClassBookings();
  }, [classData.id]);

  useEffect(() => {
    setCapacityInput(String(classData.maxStudents));
  }, [classData.maxStudents]);

  const fetchClassBookings = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          profiles!inner(full_name, email)
        `)
        .eq('class_id', classData.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const items = Array.isArray(data) ? data : [];
      const mapped = items.map((b: any) => {
        const toCents = (value: any) => Math.max(0, Math.round(Number(value ?? 0)));
        const rawNames = Array.isArray(b.studentNames)
          ? b.studentNames
          : Array.isArray(b.student_names)
            ? b.student_names
            : Array.isArray(b.metadata?.student_names)
              ? b.metadata.student_names
              : [];

        const studentNames = rawNames
          .map((name: any) => (typeof name === 'string' ? name.trim() : ''))
          .filter(Boolean);

        const qty = Number(b.qty ?? 0);

        return {
          id: b.id,
          classId: b.class_id,
          userId: b.user_id,
          userEmail: b.profiles?.email || '',
          userName: b.profiles?.full_name || '',
          hostId: classData.hostId,
          hostEmail: '',
          hostName: classData.hostName || user.name,
          studentCount: qty > 0 ? qty : studentNames.length || 1,
          studentNames,
          totalAmount: toCents(b.total_cents),
          subtotal: toCents(b.host_payout_cents),
          herdFee: toCents(b.platform_fee_cents),
          status: (b.status || 'PENDING').toUpperCase(),
          paymentStatus: (b.payment_status || 'PENDING').toUpperCase(),
          createdAt: b.created_at || '',
          autoApprove: false,
          approved_at: b.approved_at || null,
          denied_at: b.denied_at || null,
          host_message: b.host_message || null,
          stripePaymentIntentId: b.stripe_payment_intent_id || null,
          isGuestBooking: false,
        } as Booking;
      });

      setBookings(mapped);
    } catch (error) {
      console.error('Error fetching class bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatClassDateRange = (startDate?: string, endDate?: string) => {
    const range = formatDateRangeShort(startDate, endDate);
    if (range) return range;
    return startDate ? formatDate(startDate) : 'Date TBD';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'APPROVED': return 'bg-green-100 text-green-800';
      case 'DENIED': return 'bg-red-100 text-red-800';
      case 'FAILED': return 'bg-gray-100 text-gray-800';
      case 'PAID': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING': return <AlertCircle className="h-4 w-4" />;
      case 'APPROVED': return <CheckCircle className="h-4 w-4" />;
      case 'PAID': return <CheckCircle className="h-4 w-4" />;
      case 'DENIED': return <XCircle className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  const PENDINGBookings = bookings.filter(b => b.status === 'PENDING');
  const APPROVEDBookings = bookings.filter(b => b.status === 'APPROVED' || b.status === 'PAID');
  const approvedBookingCount = APPROVEDBookings.length;
  const hasApprovedBookings = approvedBookingCount > 0;
  const isHost = classData.instructorId === user.id;
  const canEditAllFields = !isPastClass && (user.isAdmin || (isHost && !hasApprovedBookings));
  const hostRestrictedToCapacity = !isPastClass && !user.isAdmin && isHost && hasApprovedBookings;
  const hostCannotDeleteClass = !user.isAdmin && isHost && hasApprovedBookings;
  const editButtonLabel = canEditAllFields ? 'Edit' : 'Adjust Capacity';
  const showEditButton = !isPastClass && (user.isAdmin || isHost);
  const minimumCapacity = Math.max(approvedBookingCount, 1);
  const parsedCapacity = capacityInput.trim() === '' ? NaN : Math.floor(Number(capacityInput));
  const capacityValue = Number.isNaN(parsedCapacity) ? null : Math.max(0, parsedCapacity);
  const capacityBelowMinimum = capacityValue !== null && capacityValue < minimumCapacity;

  useEffect(() => {
    if (!hostRestrictedToCapacity) {
      setIsEditingCapacity(false);
    }
  }, [hostRestrictedToCapacity]);

  const orderedBookings = useMemo(() => {
    const toTimestamp = (value?: string | null) => {
      if (!value) return 0;
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    };

    const pending = bookings
      .filter((booking) => booking.status === 'PENDING')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const confirmed = bookings
      .filter((booking) => booking.status === 'APPROVED' || booking.status === 'PAID')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const denied = bookings
      .filter((booking) => booking.status === 'DENIED')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const remaining = bookings
      .filter(
        (booking) =>
          booking.status !== 'PENDING' &&
          booking.status !== 'APPROVED' &&
          booking.status !== 'PAID' &&
          booking.status !== 'DENIED'
      )
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    return [...pending, ...confirmed, ...denied, ...remaining];
  }, [bookings]);

  const handleCapacitySave = async () => {
    if (capacityValue === null) {
      toast.warning('Enter the maximum number of students.');
      return;
    }

    if (capacityBelowMinimum) {
      toast.warning(`Capacity cannot be lower than ${minimumCapacity}.`);
      return;
    }

    setIsSavingCapacity(true);
    const success = await onUpdateClass(
      classData.id,
      { maxStudents: capacityValue },
      {
        minimumMaxStudents: minimumCapacity,
        hasApprovedBookings: hasApprovedBookings,
        successMessage: 'Class capacity updated successfully.',
      }
    );
    setIsSavingCapacity(false);

    if (success) {
      setIsEditingCapacity(false);
    }
  };

  const handleCancelCapacityEdit = () => {
    setCapacityInput(String(classData.maxStudents));
    setIsEditingCapacity(false);
  };
  const totalRevenueCents = APPROVEDBookings.reduce((sum, b) => sum + b.subtotal, 0);
  const totalRevenueDisplay = formatPrice(totalRevenueCents, { withCurrency: true });
  const totalStudents = APPROVEDBookings.reduce((sum, b) => sum + b.studentCount, 0);

  return (
    <>
      <div className="max-w-6xl mx-auto p-3 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('dashboard')}
            className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          {user.isAdmin && (
            <Badge className="bg-orange-500 text-white">
              Admin View
            </Badge>
          )}
        </div>
        <h1 className="text-2xl md:text-3xl text-[#3c4f21] mb-2">Class Management</h1>
        <p className="text-[#556B2F]">
          {isPastClass
            ? 'Review class details and booking history.'
            : 'Manage bookings, view details, and edit your class'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Class Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info Card */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-[#3c4f21] text-xl">{classData.title}</CardTitle>
                  <p className="text-[#556B2F] mt-2">{classData.shortSummary}</p>
                </div>
                <div className="flex gap-2">
                  {showEditButton ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                      onClick={() => {
                        if (canEditAllFields || user.isAdmin) {
                          onEditClass(classData);
                        } else if (hostRestrictedToCapacity) {
                          setIsEditingCapacity(true);
                          toast.info('Only class capacity can be updated now. Adjust the maximum number of students below.');
                        } else {
                          toast.warning('You do not have permission to edit this class.');
                        }
                      }}
                      title={
                        canEditAllFields || user.isAdmin
                          ? 'Edit class details'
                          : 'Adjust the maximum number of students'
                      }
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      {editButtonLabel}
                    </Button>
                  ) : (
                    isPastClass && (
                      <div className="max-w-xs self-center text-xs sm:text-sm text-[#556B2F] italic">
                        Past classes are read-only. Relaunch to make updates.
                      </div>
                    )
                  )}
                  {/* Only show delete button to admins and class hosts */}
                  {(user.isAdmin || classData.instructorId === user.id) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`border disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none ${
                        hostCannotDeleteClass
                          ? 'border-gray-300 text-gray-400 bg-gray-100'
                          : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                      }`}
                      disabled={hostCannotDeleteClass}
                      onClick={() => onDeleteClass(classData.id)}
                      title={
                        user.isAdmin
                          ? "Delete class (Admin privileges)"
                          : hostCannotDeleteClass
                            ? "This class has approved bookings and cannot be deleted"
                            : "Delete class (no approved bookings)"
                      }
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                      {user.isAdmin && (
                        <Badge className="ml-2 bg-orange-500 text-white text-xs px-1 py-0">
                          ADMIN
                        </Badge>
                      )}
                    </Button>
                  )}
                  {hostCannotDeleteClass && (
                    <p className="mt-2 text-xs text-[#556B2F]">
                      Approved bookings prevent deleting this class. Contact support if you need assistance.
                    </p>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Class Photo */}
              <div className="mb-6">
                <div className="relative w-full h-48 md:h-64 bg-gray-100 rounded-lg overflow-hidden">
                  {classData.photos && classData.photos.length > 0 ? (
                    <ImageWithFallback
                      src={classData.photos[0]}
                      alt={classData.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center">
                      <div className="text-center text-[#556B2F]">
                        <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm opacity-70">No photo uploaded</p>
                      </div>
                    </div>
                  )}
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-[#556B2F] text-[#f8f9f6]">
                      {formatPrice(classData.pricePerPerson, { withCurrency: true })} / person
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Date & Time</p>
                      <p className="font-medium text-[#3c4f21]">
                        {formatClassDateRange(classData.startDate, classData.endDate)}
                        {classData.startTime && ` at ${formatTime(classData.startTime)}`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Duration</p>
                      <p className="font-medium text-[#3c4f21]">
                        {classData.numberOfDays} day{classData.numberOfDays > 1 ? 's' : ''}
                        {classData.hoursPerDay && ` (${classData.hoursPerDay} hours/day)`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Capacity</p>
                      <p className="font-medium text-[#3c4f21]">
                        {totalStudents} / {classData.maxStudents} students
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Location</p>
                      <p className="font-medium text-[#3c4f21]">
                        {classData.address.street}
                      </p>
                      <p className="text-sm text-[#556B2F]">
                        {classData.address.city}, {classData.address.state} {classData.address.zipCode}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <DollarSign className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Booking Settings</p>
                      <p className="font-medium text-[#3c4f21]">
                        {classData.auto_approve ? 'Auto-approve enabled' : 'Manual approval required'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-[#556B2F]" />
                    <div>
                      <p className="text-sm text-[#556B2F]">Age Requirement</p>
                      <p className="font-medium text-[#3c4f21]">
                        {classData.minimumAge}+ years old
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Additional Details */}
              {(classData.instructorBio || classData.advisories || classData.houseRules) && (
                <div className="mt-6 space-y-4">
                  {classData.instructorBio && (
                    <div>
                      <h4 className="font-medium text-[#3c4f21] mb-2">About the Instructor</h4>
                      <p className="text-sm text-[#556B2F] leading-relaxed">{classData.instructorBio}</p>
                    </div>
                  )}
                  
                  {classData.advisories && (
                    <div>
                      <h4 className="font-medium text-[#3c4f21] mb-2">Important Advisories</h4>
                      <p className="text-sm text-[#556B2F] leading-relaxed">{classData.advisories}</p>
                    </div>
                  )}
                  
                  {classData.houseRules && (
                    <div>
                      <h4 className="font-medium text-[#3c4f21] mb-2">House Rules</h4>
                      <p className="text-sm text-[#556B2F] leading-relaxed">{classData.houseRules}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[#556B2F]">Total Bookings</p>
                    <p className="text-2xl font-bold text-[#3c4f21]">{bookings.length}</p>
                  </div>
                  <Users className="h-8 w-8 text-[#556B2F]" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[#556B2F]">Revenue</p>
                    <p className="text-2xl font-bold text-[#3c4f21]">{totalRevenueDisplay}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-[#556B2F]" />
                </div>
              </CardContent>
            </Card>

            {PENDINGBookings.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[#556B2F]">Pending</p>
                      <p className="text-2xl font-bold text-[#c54a2c]">{PENDINGBookings.length}</p>
                    </div>
                    <AlertCircle className="h-8 w-8 text-[#c54a2c]" />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {hostRestrictedToCapacity && (
            <Card>
              <CardHeader>
                <CardTitle className="text-[#3c4f21] text-lg">Manage Capacity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-[#556B2F]">
                  Approved bookings: <strong>{approvedBookingCount}</strong>
                </p>
                <p className="text-sm text-[#556B2F]">
                  Current capacity: <strong>{classData.maxStudents}</strong> students
                </p>

                {isEditingCapacity ? (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={capacityInput}
                        onChange={(e) => {
                          const next = e.target.value.replace(/[^0-9]/g, '');
                          setCapacityInput(next);
                        }}
                        placeholder={String(minimumCapacity)}
                        className="sm:flex-1 border-[#556B2F] text-[#3c4f21]"
                        aria-label="Maximum number of students"
                      />
                      <Button
                        size="sm"
                        className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
                        onClick={handleCapacitySave}
                        disabled={isSavingCapacity || capacityValue === null || capacityBelowMinimum}
                      >
                        {isSavingCapacity ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancelCapacityEdit}
                        disabled={isSavingCapacity}
                      >
                        Cancel
                      </Button>
                    </div>
                    <p className="text-xs text-[#556B2F]">
                      Capacity cannot drop below {minimumCapacity}. This matches the number of approved bookings.
                    </p>
                    {capacityBelowMinimum && (
                      <p className="text-xs text-red-600">
                        Increase capacity to at least {minimumCapacity} students before saving.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[#556B2F]">
                      Once bookings are approved, only the maximum number of students can be adjusted.
                    </p>
                    <Button
                      size="sm"
                      className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
                      onClick={() => setIsEditingCapacity(true)}
                    >
                      Adjust Capacity
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-[#3c4f21]">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                disabled={(!user.isAdmin && !isHost) || APPROVEDBookings.length === 0}
                onClick={() => {
                  if (!user.isAdmin && !isHost) {
                    toast.warning('Only the class host can message students.');
                    return;
                  }
                  if (APPROVEDBookings.length === 0) {
                    toast.info('No confirmed students to message yet.');
                    return;
                  }
                  setShowBroadcastModal(true);
                }}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Message Students
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bookings Section */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-[#3c4f21]">Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
                <p className="text-gray-500">Loading bookings...</p>
              </div>
            ) : bookings.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No bookings yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orderedBookings.map((booking) => {
                  const isDenied = booking.status === 'DENIED';
                  const displayedEarnings = isDenied ? 0 : booking.subtotal;

                  return (
                  <div key={booking.id} className="border border-[#a8b892] rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-medium text-[#3c4f21]">{booking.userName}</h4>
                          <Badge className={getStatusColor(booking.status)}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(booking.status)}
                              {booking.status}
                            </div>
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-[#556B2F]">
                          <p><strong>Email:</strong> {booking.userEmail}</p>
                          <p><strong>Students:</strong> {booking.studentCount}</p>
                          <p><strong>Names:</strong> {booking.studentNames.join(', ')}</p>
                          <p><strong>Your earnings:</strong> {formatPrice(displayedEarnings, { withCurrency: true })}</p>
                          <p><strong>Booked:</strong> {formatDate(booking.createdAt)}</p>
                          <p><strong>Payment:</strong> {booking.paymentStatus}</p>
                        </div>
                        
                        {booking.status === 'DENIED' && booking.host_message && (
                          <div className="bg-red-50 border border-red-200 rounded p-2 mt-2">
                            <p className="text-sm text-red-800"><strong>Denial reason:</strong> {booking.host_message}</p>
                          </div>
                        )}
                      </div>
                      
                      {booking.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => {
                              // Handle booking approval
                              toast.info('Booking approval functionality will be integrated with the existing system');
                            }}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setSelectedBooking(booking)}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Deny
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      {selectedBooking && renderBookingModal()}
      {showBroadcastModal && (
        <BroadcastMessageModal
          classId={classData.id}
          hostId={classData.hostId || user.id}
          classTitle={classData.title}
          onClose={() => setShowBroadcastModal(false)}
        />
      )}
    </>
  );
}
