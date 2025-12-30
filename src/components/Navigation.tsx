import React, { useState } from "react";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import {
  BookOpen,
  PlusCircle,
  MessageSquare,
  User,
  LogOut,
  LayoutDashboard,
  Menu,
} from "lucide-react";
import type { Page, User as UserType } from "@/types/domain";

type NavigationProps = {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: UserType | null;
  onSignOut: () => void;
  onShowAuth: () => void;
};

export function Navigation({
  currentPage,
  onNavigate,
  user,
  onSignOut,
  onShowAuth,
}: NavigationProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const displayName = user?.name || user?.email || "Profile";

  const handleNavigate = (page: Page) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const handleSignOut = () => {
    onSignOut();
    setMobileMenuOpen(false);
  };

  const handleShowAuth = () => {
    onShowAuth();
    setMobileMenuOpen(false);
  };

  return (
    <nav className="bg-[#556B2F] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <button
              onClick={() => handleNavigate('home')}
              className="text-2xl font-bold text-[#f8f9f6] hover:text-[#a8b892] transition-colors duration-200"
            >
              HERD
            </button>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex space-x-4">
              <Button
                variant={currentPage === 'classes' ? 'secondary' : 'ghost'}
                onClick={() => onNavigate('classes')}
                className={`${
                  currentPage === 'classes' 
                    ? 'bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]' 
                    : 'text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]'
                }`}
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Classes
              </Button>
              
              <Button
                variant={currentPage === 'create-class' ? 'secondary' : 'ghost'}
                onClick={() => onNavigate('create-class')}
                className={`${
                  currentPage === 'create-class' 
                    ? 'bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]' 
                    : 'text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]'
                }`}
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                {user && !user.stripeConnected ? 'Setup Stripe' : 'Teach'}
              </Button>
              
              <Button
                variant={currentPage === 'bulletin' ? 'secondary' : 'ghost'}
                onClick={() => onNavigate('bulletin')}
                className={`${
                  currentPage === 'bulletin' 
                    ? 'bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]' 
                    : 'text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]'
                }`}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Bulletin
              </Button>

              {/* Dashboard - only show for authenticated users */}
              {user && (
                <Button
                  variant={currentPage === 'dashboard' ? 'secondary' : 'ghost'}
                  onClick={() => onNavigate('dashboard')}
                  className={`${
                    currentPage === 'dashboard' 
                      ? 'bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]' 
                      : 'text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
              )}
            </div>

            {/* User Menu */}
            {user ? (
              <div className="flex items-center space-x-2">
                <Button
                  variant={currentPage === 'profile' ? 'secondary' : 'ghost'}
                  onClick={() => onNavigate('profile')}
                  className={`${
                    currentPage === 'profile' 
                      ? 'bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]' 
                      : 'text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]'
                  }`}
                >
                  <User className="w-4 h-4 mr-2" />
                  {displayName}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onSignOut}
                  className="text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={onShowAuth}
                className="bg-[#f8f9f6] text-[#556B2F] hover:bg-[#f0f2ed]"
              >
                Sign In
              </Button>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-[#f8f9f6] hover:bg-[#6B7F3F] hover:text-[#f8f9f6]"
                >
                  <Menu className="w-6 h-6" />
                </Button>
              </SheetTrigger>
              <SheetContent 
                side="right" 
                className="w-80 bg-[#f8f9f6] border-l border-[#556B2F]/20"
              >
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <SheetDescription className="sr-only">
                  Access navigation links and user account options
                </SheetDescription>
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-6 border-b border-[#556B2F]/20">
                    <button
                      onClick={() => handleNavigate('home')}
                      className="text-2xl font-bold text-[#556B2F] hover:text-[#3c4f21] transition-colors duration-200"
                    >
                      HERD
                    </button>
                  </div>

                  {/* Navigation Links */}
                  <div className="flex-1 py-6">
                    <div className="space-y-3">
                      <Button
                        variant={currentPage === 'classes' ? 'default' : 'ghost'}
                        onClick={() => handleNavigate('classes')}
                        className={`w-full justify-start h-12 ${
                          currentPage === 'classes' 
                            ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]' 
                            : 'text-[#556B2F] hover:bg-[#556B2F]/10'
                        }`}
                      >
                        <BookOpen className="w-5 h-5 mr-3" />
                        Classes
                      </Button>
                      
                      <Button
                        variant={currentPage === 'create-class' ? 'default' : 'ghost'}
                        onClick={() => handleNavigate('create-class')}
                        className={`w-full justify-start h-12 ${
                          currentPage === 'create-class' 
                            ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]' 
                            : 'text-[#556B2F] hover:bg-[#556B2F]/10'
                        }`}
                      >
                        <PlusCircle className="w-5 h-5 mr-3" />
                        {user && !user.stripeConnected ? 'Setup Stripe' : 'Teach'}
                      </Button>
                      
                      <Button
                        variant={currentPage === 'bulletin' ? 'default' : 'ghost'}
                        onClick={() => handleNavigate('bulletin')}
                        className={`w-full justify-start h-12 ${
                          currentPage === 'bulletin' 
                            ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]' 
                            : 'text-[#556B2F] hover:bg-[#556B2F]/10'
                        }`}
                      >
                        <MessageSquare className="w-5 h-5 mr-3" />
                        Bulletin
                      </Button>

                      {/* Dashboard - only show for authenticated users */}
                      {user && (
                        <Button
                          variant={currentPage === 'dashboard' ? 'default' : 'ghost'}
                          onClick={() => handleNavigate('dashboard')}
                          className={`w-full justify-start h-12 ${
                            currentPage === 'dashboard' 
                              ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]' 
                              : 'text-[#556B2F] hover:bg-[#556B2F]/10'
                          }`}
                        >
                          <LayoutDashboard className="w-5 h-5 mr-3" />
                          Dashboard
                        </Button>
                      )}

                      {user && (
                        <Button
                          variant={currentPage === 'profile' ? 'default' : 'ghost'}
                          onClick={() => handleNavigate('profile')}
                          className={`w-full justify-start h-12 ${
                            currentPage === 'profile' 
                              ? 'bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]' 
                              : 'text-[#556B2F] hover:bg-[#556B2F]/10'
                          }`}
                        >
                          <User className="w-5 h-5 mr-3" />
                          Profile
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* User Actions */}
                  <div className="pt-6 border-t border-[#556B2F]/20">
                    {user ? (
                      <div className="space-y-3">
                        <div className="px-3 py-2 bg-[#556B2F]/5 rounded-lg">
                          <p className="text-sm text-[#556B2F]/70">Signed in as</p>
                          <p className="font-medium text-[#556B2F]">{user.name}</p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleSignOut}
                          className="w-full justify-start h-12 border-[#556B2F]/20 text-[#556B2F] hover:bg-[#556B2F]/10"
                        >
                          <LogOut className="w-5 h-5 mr-3" />
                          Sign Out
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="default"
                        onClick={handleShowAuth}
                        className="w-full h-12 bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]"
                      >
                        Sign In
                      </Button>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}
