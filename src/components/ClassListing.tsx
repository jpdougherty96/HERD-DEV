import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Calendar, MapPin, Users, Clock, Plus, Search, Image as ImageIcon, Heart as HeartOutline, HeartIcon, Star } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { BookingModal } from './BookingModal';
import type { Class, User, Page } from '../App';
import { formatPrice } from '../utils/money';
import { formatDateRangeShort, formatTime as formatTimeDisplay } from '../utils/time';
import { toast } from 'sonner@2.0.3';

type ClassListingProps = {
  classes: Class[];
  onNavigate: (page: Page) => void;
  user: User | null;
  onRequireAuth: () => void;
  onSelectClass: (classData: Class) => void;
  favorites: string[];
  onToggleFavorite: (classId: string) => void;
};

export function ClassListing({ classes, onNavigate, user, onRequireAuth, onSelectClass, favorites, onToggleFavorite }: ClassListingProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [bookingClass, setBookingClass] = useState<Class | null>(null);

  const now = Date.now();

  const isPastClass = (cls: Class) => {
    const dateStr = cls.endDate || cls.startDate;
    if (!dateStr) return false;
    const end = new Date(`${dateStr}T${cls.startTime || "00:00:00"}`);
    if (Number.isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999);
    return end.getTime() < now;
  };

  const filteredClasses = classes
    .filter((cls) => !isPastClass(cls))
    .filter(cls =>
      cls.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cls.shortSummary.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cls.instructorName.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const formatClassDates = (cls: Class) =>
    formatDateRangeShort(cls.startDate, cls.endDate) || 'Date TBD';

  const formatAddress = (address: any) => {
    if (typeof address === 'string') {
      // For legacy string addresses, try to extract city/state or return as-is
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
    // Refresh the page or update local state as needed
    // For now, we'll just close the modal
    setBookingClass(null);
  };

  const ClassCard = ({ cls }: { cls: Class }) => {
    const isFavorite = favorites.includes(cls.id);
    const handleFavoriteClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      onToggleFavorite(cls.id);
    };
    const ratingCount =
      cls.hostRatingCount ??
      cls.hostProfile?.ratingCount ??
      0;
    const averageRating = (() => {
      if (typeof cls.hostRatingAverage === 'number') return cls.hostRatingAverage;
      const fallback = cls.hostProfile?.ratingAverage;
      return typeof fallback === 'number' ? fallback : null;
    })();
    const hasRating = averageRating !== null && Number.isFinite(averageRating) && ratingCount > 0;

    return (
      <Card className="bg-[#ffffff] border-[#a8b892] shadow-lg hover:shadow-xl transition-all cursor-pointer overflow-hidden"
        onClick={() => onSelectClass(cls)}>
      {/* Class Photo */}
      <div className="relative w-full h-48 md:h-52 bg-gray-100">
        {cls.photos && cls.photos.length > 0 ? (
          <ImageWithFallback
            src={cls.photos[0]}
            alt={cls.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center">
            <div className="text-center text-[#556B2F]">
              <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm opacity-70">No photo available</p>
            </div>
          </div>
        )}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <Badge className="bg-[#556B2F] text-[#f8f9f6] hover:bg-[#556B2F]">
            {formatPrice(cls.pricePerPerson, { withCurrency: true })}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleFavoriteClick}
            className="h-9 w-9 rounded-full bg-white/80 text-[#c54a2c] hover:bg-white"
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? <HeartIcon className="h-5 w-5 fill-current" /> : <HeartOutline className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-[#2d3d1f] leading-tight">{cls.title}</CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <p className="text-[#3c4f21] text-sm line-clamp-2">{cls.shortSummary}</p>

        <div className="grid grid-cols-2 gap-3 text-sm text-[#3c4f21]">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#556B2F] flex-shrink-0" />
            <span className="truncate">{formatClassDates(cls)}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#556B2F] flex-shrink-0" />
            <span className="truncate">
              {cls.startTime
                ? formatTimeDisplay(cls.startTime)
                : `${cls.numberOfDays} day${cls.numberOfDays > 1 ? 's' : ''}`}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#556B2F] flex-shrink-0" />
            <span className="truncate">Max {cls.maxStudents} students</span>
          </div>
          
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#556B2F] flex-shrink-0" />
            <span className="truncate">{formatAddress(cls.address)}</span>
          </div>
        </div>
        
        <div className="pt-2 border-t border-[#a8b892] space-y-1">
          <p className="text-sm text-[#3c4f21] truncate">
            <span className="font-medium">Instructor:</span> {cls.instructorName}
          </p>
          {hasRating ? (
            <div className="flex items-center gap-2 text-sm text-[#3c4f21]">
              <Star className="w-4 h-4 text-[#f2b01e]" />
              <span>
                {averageRating!.toFixed(1)} ({ratingCount} review{ratingCount === 1 ? '' : 's'})
              </span>
            </div>
          ) : (
            <p className="text-sm text-[#6b7c5b]">No reviews yet</p>
          )}
        </div>
      </CardContent>
    </Card>
    );
  };



  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#2d3d1f] mb-2">Homesteading Classes</h1>
            <p className="text-[#3c4f21]">Discover hands-on learning opportunities in your community</p>
          </div>
          
          <Button 
            onClick={() => {
          if (!user) {
            onRequireAuth();
          } else if (!user.stripeConnected) {
            toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
            onNavigate('profile');
          } else {
            onNavigate('create-class');
          }
            }}
            className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
          >
            <Plus className="w-4 h-4 mr-2" />
            {!user ? 'Sign In to Teach' : !user.stripeConnected ? 'Setup Stripe to Teach' : 'Create Class'}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#556B2F] h-4 w-4" />
          <Input
            type="text"
            placeholder="Search classes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 !pl-12 pr-4 bg-[#ffffff] border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
          />
        </div>
      </div>

      {/* Classes Grid */}
      {filteredClasses.length === 0 ? (
        <Card className="bg-[#ffffff] border-[#a8b892] p-12 text-center">
          <div className="space-y-4">
            <h3 className="text-xl text-[#2d3d1f]">
              {classes.length === 0 ? 'No classes available yet' : 'No classes match your search'}
            </h3>
            <p className="text-[#3c4f21]">
              {classes.length === 0 
                ? 'Be the first to create a class and share your homesteading knowledge!'
                : 'Try adjusting your search terms or browse all available classes.'
              }
            </p>
            <Button 
              onClick={() => {
              if (!user) {
                onRequireAuth();
              } else if (!user.stripeConnected) {
                toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
                onNavigate('profile');
              } else {
                onNavigate('create-class');
                }
              }}
              className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
            >
              <Plus className="w-4 h-4 mr-2" />
              {!user ? 'Sign In to Create Class' : !user.stripeConnected ? 'Setup Stripe to Create Class' : 'Create the First Class'}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClasses.map((cls) => (
            <ClassCard key={cls.id} cls={cls} />
          ))}
        </div>
      )}

      {/* Booking Modal */}
      {bookingClass && user && (
        <BookingModal 
          classData={bookingClass}
          user={user}
          onClose={() => setBookingClass(null)}
          onBookingSuccess={handleBookingSuccess}
        />
      )}
    </div>
  );
}
