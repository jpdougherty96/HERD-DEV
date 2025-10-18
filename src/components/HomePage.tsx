import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { BookOpen, MessageSquare, Users, MapPin } from 'lucide-react';
import type { Page, User } from '../App';
import { toast } from 'sonner@2.0.3';

type HomePageProps = {
  onNavigate: (page: Page) => void;
  user: User | null;
  onRequireAuth: () => void;
};

export function HomePage({ onNavigate, user, onRequireAuth }: HomePageProps) {
  const handleNavigateWithAuth = (page: 'create-class' | 'profile', requireAuth = false) => {
    if (requireAuth && !user) {
      onRequireAuth();
    } else if (user && !user.stripeConnected) {
      toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
      onNavigate('profile');
    } else {
      onNavigate(page);
    }
  };

  return (
    <div className="relative">
      {/* Hero Section */}
      <div 
        className="relative h-96 bg-cover bg-center"
        style={{
          backgroundImage: `linear-gradient(rgba(85, 107, 47, 0.6), rgba(85, 107, 47, 0.6)), url('https://images.unsplash.com/photo-1567456035144-5b7969382b9b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxydXN0aWMlMjBmYXJtJTIwYmFybiUyMGNvdW50cnlzaWRlfGVufDF8fHx8MTc1ODQwNDkxNnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral')`
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-[#f8f9f6] max-w-4xl px-6">
            <h1 className="text-4xl md:text-6xl font-bold mb-4 text-white">
              The Learning Hub for Homesteaders
            </h1>
            <p className="text-xl md:text-2xl mb-8 opacity-90">
              Connect, learn, and share knowledge in your homesteading community
            </p>
            <Button 
              onClick={() => onNavigate('classes')}
              size="lg"
              className="bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6] px-8 py-3"
            >
              Browse Classes Nearby
            </Button>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <Card className="bg-[#ffffff] border-[#a8b892] shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 bg-[#556B2F] rounded-full flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-[#f8f9f6]" />
              </div>
              <h3 className="text-xl font-semibold text-[#2d3d1f] mb-3">Learn New Skills</h3>
              <p className="text-[#3c4f21] mb-4">
                Discover hands-on classes from experienced homesteaders in your area. From gardening to animal care, expand your knowledge.
              </p>
              <Button 
                variant="outline" 
                onClick={() => onNavigate('classes')}
                className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
              >
                Browse Classes
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-[#ffffff] border-[#a8b892] shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 bg-[#556B2F] rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-[#f8f9f6]" />
              </div>
              <h3 className="text-xl font-semibold text-[#2d3d1f] mb-3">Teach & Share</h3>
              <p className="text-[#3c4f21] mb-4">
                Share your expertise with fellow homesteaders. Host classes at your homestead and build community connections.
              </p>
              <Button 
                variant="outline" 
                onClick={() => handleNavigateWithAuth('create-class', true)}
                className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
              >
                {!user ? 'Sign In to Teach' : !user.stripeConnected ? 'Setup Stripe to Teach' : 'Create a Class'}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-[#ffffff] border-[#a8b892] shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 bg-[#556B2F] rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-[#f8f9f6]" />
              </div>
              <h3 className="text-xl font-semibold text-[#2d3d1f] mb-3">Community Board</h3>
              <p className="text-[#3c4f21] mb-4">
                Connect with neighbors, share tips, ask questions, and stay updated on local homesteading news and events.
              </p>
              <Button 
                variant="outline" 
                onClick={() => onNavigate('bulletin')}
                className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
              >
                Visit Bulletin
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* How It Works Section */}
      <div className="bg-[#556B2F] py-16">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-[#f8f9f6] mb-12">
            How HERD Works
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#f8f9f6] rounded-full flex items-center justify-center mx-auto mb-4">
                <MapPin className="w-8 h-8 text-[#556B2F]" />
              </div>
              <h3 className="text-xl font-semibold text-[#f8f9f6] mb-3">1. Find Classes Nearby</h3>
              <p className="text-[#a8b892]">
                Browse local homesteading classes and workshops hosted by experienced community members.
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-[#f8f9f6] rounded-full flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-[#556B2F]" />
              </div>
              <h3 className="text-xl font-semibold text-[#f8f9f6] mb-3">2. Book Securely</h3>
              <p className="text-[#a8b892]">
                Reserve your spot in classes that interest you. Connect directly with instructors and get all the details.
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-[#f8f9f6] rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-[#556B2F]" />
              </div>
              <h3 className="text-xl font-semibold text-[#f8f9f6] mb-3">3. Learn & Connect</h3>
              <p className="text-[#a8b892]">
                Attend hands-on classes, learn new skills, and build lasting connections with fellow homesteaders.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-[#ffffff] py-16">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-3xl font-bold text-[#2d3d1f] mb-4">
            Ready to Grow Your Homesteading Skills?
          </h2>
          <p className="text-[#3c4f21] text-lg mb-8">
            Join our community of passionate homesteaders and start learning today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {user ? (
              <Button 
                onClick={() => onNavigate('dashboard')}
                size="lg"
                className="min-w-[220px] bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
              >
                Go to Dashboard
              </Button>
            ) : (
              <Button 
                onClick={() => onNavigate('classes')}
                size="lg"
                className="min-w-[220px] bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
              >
                Start Learning
              </Button>
            )}
            <Button 
              onClick={() => handleNavigateWithAuth('create-class', true)}
              size="lg"
              className="min-w-[220px] bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
            >
              {!user ? 'Sign In to Teach' : !user.stripeConnected ? 'Setup Stripe to Teach' : 'Start Teaching'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
