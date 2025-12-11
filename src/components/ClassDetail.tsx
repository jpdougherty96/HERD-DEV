import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ArrowLeft, Calendar, MapPin, Users, DollarSign, Clock, ChevronLeft, ChevronRight, Image as ImageIcon, MessageSquare, Heart as HeartOutline, HeartIcon, Star } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { BookingModal } from './BookingModal';
import { MessageModal } from './MessageModal';
import { PhotoLightbox } from './PhotoLightbox';
import { supabase } from '../utils/supabaseClient';
import {
  formatDateRangeDisplay,
  formatPrice,
  formatTime,
} from '@/utils/formatting';
import type { Class, Page, User } from '../App';
import { toast } from 'sonner@2.0.3';
import { useExistingConversation } from './useExistingConversation';

type ClassDetailProps = {
  classData: Class;
  user: User | null;
  onNavigate: (page: Page) => void;
  onRequireAuth: () => void;
  onViewHost?: (hostId: string, classData: Class) => void;
  favorites: string[];
  onToggleFavorite: (classId: string) => void;
  onOpenConversation?: (conversationId: string, classData: Class) => void;
};

export function ClassDetail({ classData, user, onNavigate, onRequireAuth, onViewHost, favorites, onToggleFavorite, onOpenConversation }: ClassDetailProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [bookingClass, setBookingClass] = useState<Class | null>(null);
  const [availableSpots, setAvailableSpots] = useState<number | null>(null);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [instructorAvatarUrl, setInstructorAvatarUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // --- PRICE NORMALIZATION (handles both dollars or cents in pricePerPerson) ---
  const priceDisplay = formatPrice(classData.pricePerPerson, { withCurrency: true });
  const shouldShowHoursPerDay =
    typeof classData.hoursPerDay === 'number' &&
    Number.isFinite(classData.hoursPerDay) &&
    classData.hoursPerDay > 0 &&
    classData.hoursPerDay < 24;

  const formatAddress = (address: any) => {
    if (typeof address === 'string') {
      return address;
    }
    return `${address.city}, ${address.state}`;
  };

  const handleBookClass = (classData: Class) => {
    if (!user) {
      onRequireAuth();
    } else {
      setBookingClass(classData);
    }
  };

  const handleBookingSuccess = () => {
    setBookingClass(null);
    // Recompute available spots after a successful booking
    void fetchAvailableSpots();
  };

  const hostIdentifier = classData.hostId || classData.host_id || classData.instructorId;
  const { conversationId, refresh: refreshConversation } = useExistingConversation(
    classData.id,
    user?.id,
  );

  const handleMessageHost = (classData: Class) => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setShowMessageModal(true);
  };

  const handleMessageSent = () => {
    toast.success(`Message sent to ${classData.instructorName}! You can continue the conversation in your dashboard messages.`);
    void refreshConversation();
    setTimeout(() => {
      void refreshConversation();
    }, 500);
  };

  useEffect(() => {
    const handler = () => {
      void refreshConversation();
      setTimeout(() => {
        void refreshConversation();
      }, 500);
    };
    window.addEventListener('herd-message-sent', handler);
    return () => window.removeEventListener('herd-message-sent', handler);
  }, [refreshConversation]);

  const nextImage = () => {
    if (classData.photos && classData.photos.length > 1) {
      setCurrentImageIndex((prev) => prev === classData.photos!.length - 1 ? 0 : prev + 1);
    }
  };

  const prevImage = () => {
    if (classData.photos && classData.photos.length > 1) {
      setCurrentImageIndex((prev) => prev === 0 ? classData.photos!.length - 1 : prev - 1);
    }
  };

  const selectImage = (index: number) => setCurrentImageIndex(index);

  const hasMultipleImages = classData.photos && classData.photos.length > 1;
  const isFavorite = favorites.includes(classData.id);
  const handleFavoriteToggle = () => {
    onToggleFavorite(classData.id);
  };
  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const hostRatingCount =
    classData.hostRatingCount ??
    classData.hostProfile?.ratingCount ??
    0;
  const hostRatingAverage = (() => {
    if (typeof classData.hostRatingAverage === 'number') return classData.hostRatingAverage;
    const fallback = classData.hostProfile?.ratingAverage;
    return typeof fallback === 'number' ? fallback : null;
  })();
  const hostHasRating =
    hostRatingAverage !== null && Number.isFinite(hostRatingAverage) && hostRatingCount > 0;

  const handleMainImageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLightbox(currentImageIndex);
    }
  };

  // --- compute available spots directly from Supabase (no Edge Function) ---
  const fetchAvailableSpots = useCallback(async () => {
    try {
      setLoadingSpots(true);
      const { data, error } = await supabase
        .rpc('available_spots', { class_uuid: classData.id });

      if (error) throw error;
      setAvailableSpots(typeof data === 'number' ? data : null);
    } catch (e: any) {
      console.warn('Failed to fetch available spots (RPC):', e?.message || e);
      setAvailableSpots(null);
    } finally {
      setLoadingSpots(false);
    }
  }, [classData.id]);


  useEffect(() => {
    void fetchAvailableSpots();
  }, [fetchAvailableSpots, classData.maxStudents]);

  useEffect(() => {
    let cancelled = false;
    const avatarPath = classData.instructorAvatar;

    const resolveAvatar = async () => {
      if (!avatarPath) {
        if (!cancelled) setInstructorAvatarUrl(null);
        return;
      }

      if (/^https?:\/\//i.test(avatarPath)) {
        if (!cancelled) setInstructorAvatarUrl(avatarPath);
        return;
      }

      const { data, error } = await supabase.storage
        .from('avatars')
        .createSignedUrl(avatarPath, 60 * 60 * 24 * 7);

      if (!cancelled) {
        if (error) {
          console.error('Failed to create signed URL for instructor avatar:', error.message ?? error);
          setInstructorAvatarUrl(null);
        } else {
          setInstructorAvatarUrl(data?.signedUrl ?? null);
        }
      }
    };

    void resolveAvatar();

    return () => {
      cancelled = true;
    };
  }, [classData.instructorAvatar]);

  const handleViewHost = () => {
    if (!classData?.instructorId) return;
    onViewHost?.(classData.instructorId, classData);
  };

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <div className="max-w-4xl mx-auto p-6">
        {/* Back Button */}
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => onNavigate('classes')}
            className="text-[#556B2F] hover:bg-[#e8e9e6] hover:text-[#3c4f21]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Classes
          </Button>
        </div>

        {/* Class Images Section */}
        <div className="mb-8">
          <div className="relative bg-gray-100 rounded-lg overflow-hidden">
            {classData.photos && classData.photos.length > 0 ? (
              <>
                {/* Main Image */}
                <div
                  className="relative w-full h-64 md:h-96 cursor-zoom-in outline-none"
                  role="button"
                  tabIndex={0}
                  aria-label="Open photo gallery"
                  onClick={() => openLightbox(currentImageIndex)}
                  onKeyDown={handleMainImageKeyDown}
                >
                  <ImageWithFallback
                    src={classData.photos[currentImageIndex]}
                    alt={`${classData.title} - Image ${currentImageIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Navigation Arrows */}
                  {hasMultipleImages && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          prevImage();
                        }}
                        className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          nextImage();
                        }}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </Button>
                    </>
                  )}

                  {/* Image Counter */}
                  {hasMultipleImages && (
                    <div className="absolute bottom-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                      {currentImageIndex + 1} / {classData.photos.length}
                    </div>
                  )}

                  {/* Price Badge */}
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-[#556B2F] text-[#f8f9f6] hover:bg-[#556B2F] text-lg px-3 py-1">
                      {priceDisplay}
                    </Badge>
                  </div>
                </div>

                {/* Thumbnail Navigation */}
                {hasMultipleImages && (
                  <div className="flex gap-2 p-4 bg-white/90 overflow-x-auto">
                    {classData.photos.map((photo, index) => (
                      <button
                        key={index}
                        onClick={() => selectImage(index)}
                        className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                          index === currentImageIndex 
                            ? 'border-[#556B2F] shadow-md' 
                            : 'border-gray-300 hover:border-[#a8b892]'
                        }`}
                      >
                        <ImageWithFallback
                          src={photo}
                          alt={`${classData.title} - Thumbnail ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-64 md:h-96 bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center">
                <div className="text-center text-[#556B2F]">
                  <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg opacity-70">No photos available</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Class Details */}
        <div className="grid md:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="md:col-span-2 space-y-8">
            {/* Title and Instructor */}
            <div className="flex items-start gap-4">
              {instructorAvatarUrl && (
                <ImageWithFallback
                  src={instructorAvatarUrl}
                  alt={`${classData.instructorName ?? 'Instructor'} headshot`}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-[#a8b892] shadow-sm"
                />
              )}
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="text-3xl font-bold text-[#2d3d1f] mb-2">{classData.title}</h1>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleFavoriteToggle}
                    className="h-10 w-10 rounded-full bg-[#f8f1ef] text-[#c54a2c] hover:bg-[#f1dcd6]"
                    aria-pressed={isFavorite}
                    aria-label={isFavorite ? 'Remove class from favorites' : 'Add class to favorites'}
                  >
                    {isFavorite ? <HeartIcon className="h-5 w-5 fill-current" /> : <HeartOutline className="h-5 w-5" />}
                  </Button>
                </div>
                <p className="text-lg text-[#556B2F]">
                  with{' '}
                  <button
                    type="button"
                    onClick={handleViewHost}
                    className="underline underline-offset-2 decoration-[#a8b892] hover:text-[#3c4f21]"
                  >
                    {classData.instructorName}
                  </button>
                </p>
                {hostHasRating ? (
                  <div className="mt-2 flex items-center gap-2 text-sm text-[#3c4f21]">
                    <Star className="w-4 h-4 text-[#f2b01e]" />
                    <span>
                      {hostRatingAverage!.toFixed(1)} ({hostRatingCount} review{hostRatingCount === 1 ? '' : 's'})
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-[#6b7c5b]">No reviews yet</div>
                )}
              </div>
            </div>

            {/* About This Class */}
            <div>
              <h2 className="text-xl font-semibold text-[#2d3d1f] mb-3">About This Class</h2>
              <p className="text-[#3c4f21] leading-relaxed">{classData.shortSummary}</p>
            </div>

            {/* About the Instructor */}
            <div>
              <h2 className="text-xl font-semibold text-[#2d3d1f] mb-3">About the Instructor</h2>
              <p className="text-[#3c4f21] leading-relaxed">{classData.instructorBio}</p>
            </div>

            {/* Important Information */}
            {classData.advisories && (
              <div>
                <h2 className="text-xl font-semibold text-[#2d3d1f] mb-3">Important Information</h2>
                <p className="text-[#3c4f21] leading-relaxed">{classData.advisories}</p>
              </div>
            )}

            {/* House Rules */}
            {classData.houseRules && (
              <div>
                <h2 className="text-xl font-semibold text-[#2d3d1f] mb-3">House Rules</h2>
                <p className="text-[#3c4f21] leading-relaxed">{classData.houseRules}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Class Details Card */}
            <Card className="bg-[#ffffff] border-[#a8b892] sticky top-6">
              <CardHeader>
                <CardTitle className="text-[#2d3d1f]">Class Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-[#556B2F] flex-shrink-0" />
                    <div>
                      <div className="font-medium text-[#2d3d1f]">
                        {formatDateRangeDisplay(classData.startDate, classData.endDate)}
                      </div>
                      {classData.startTime && (
                        <div className="text-sm text-[#556B2F]">
                          {classData.startTime ? formatTime(classData.startTime) : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-[#556B2F] flex-shrink-0" />
                    <div>
                      <div className="font-medium text-[#2d3d1f]">
                        {classData.numberOfDays} day{classData.numberOfDays > 1 ? 's' : ''}
                      </div>
                      {shouldShowHoursPerDay && (
                        <div className="text-sm text-[#556B2F]">{classData.hoursPerDay} hours/day</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-5 h-5 text-[#556B2F] flex-shrink-0" />
                    <div>
                      <div className="font-medium text-[#2d3d1f]">{priceDisplay} per person</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-[#556B2F] flex-shrink-0" />
                    <div>
                      <div className="font-medium text-[#2d3d1f]">Max {classData.maxStudents} students</div>
                      {loadingSpots ? (
                        <div className="text-sm text-[#556B2F] animate-pulse">Loading spots...</div>
                      ) : availableSpots !== null ? (
                        <div className={`text-sm ${availableSpots > 0 ? 'text-[#556B2F]' : 'text-[#c54a2c]'}`}>
                          {availableSpots > 0 ? (
                            `${availableSpots} spot${availableSpots !== 1 ? 's' : ''} available`
                          ) : (
                            'Fully booked'
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-[#888]">Spots info unavailable</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#556B2F] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[#2d3d1f]">{formatAddress(classData.address)}</div>
                      <div className="text-xs text-[#556B2F] mt-1 italic">
                        Full address provided upon booking confirmation
                      </div>
                    </div>
                  </div>
                </div>

                {/* Requirements */}
                <div className="pt-4 border-t border-[#a8b892]">
                  <h4 className="font-semibold text-[#2d3d1f] mb-2">Requirements</h4>
                  <p className="text-sm text-[#3c4f21]">
                    <span className="font-medium">Minimum Age:</span> {classData.minimumAge} years
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="pt-4 border-t border-[#a8b892] space-y-3">
                  <Button 
                    onClick={() => handleBookClass(classData)}
                    className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6] disabled:bg-gray-400 disabled:cursor-not-allowed"
                    size="lg"
                    disabled={availableSpots === 0}
                  >
                    {availableSpots === 0 ? 'Fully Booked' : user ? (classData.auto_approve ? 'Book This Class' : 'Request Booking') : 'Sign In to Book'}
                  </Button>
                  
                  {/* Message Host / Go to Conversation Button */}
                  {user && hostIdentifier && hostIdentifier !== user.id && (
                    conversationId ? (
                      <Button
                        onClick={() => {
                          if (onOpenConversation) {
                            onOpenConversation(conversationId, classData);
                          } else {
                            const params = new URLSearchParams();
                            params.set('page', 'dashboard');
                            params.set('tab', 'messages');
                            params.set('conversation', conversationId);
                            params.set('class', classData.id);
                            params.set('class_title', classData.title);
                            window.location.href = `${window.location.origin}?${params.toString()}`;
                          }
                        }}
                        variant="outline"
                        className="w-full border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                        size="lg"
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Go to Conversation
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleMessageHost(classData)}
                        variant="outline"
                        className="w-full border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                        size="lg"
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Message Host
                      </Button>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <PhotoLightbox
        photos={classData.photos ?? []}
        open={lightboxOpen}
        startIndex={currentImageIndex}
        onClose={() => setLightboxOpen(false)}
        onIndexChange={(next) => setCurrentImageIndex(next)}
        title={classData.title}
      />

      {/* Booking Modal */}
      {bookingClass && user && (
        <BookingModal 
          classData={bookingClass}
          user={user}
          initialAvailableSpots={availableSpots}
          onClose={() => setBookingClass(null)}
          onBookingSuccess={handleBookingSuccess}
        />
      )}

      {/* Message Modal */}
      {showMessageModal && user && (
        <MessageModal
          classData={classData}
          user={user}
          onClose={() => setShowMessageModal(false)}
          onMessageSent={handleMessageSent}
        />
      )}
    </div>
  );
}
