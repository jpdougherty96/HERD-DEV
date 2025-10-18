import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Mail, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../utils/supabase/client';
import { toast } from 'sonner@2.0.3';

type EmailVerificationBannerProps = {
  userEmail?: string;
};

export function EmailVerificationBanner({ userEmail }: EmailVerificationBannerProps) {
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastResendTime, setLastResendTime] = useState<number | null>(null);

  const handleResendVerification = async () => {
    if (!userEmail) {
      toast.error('Missing email address');
      return;
    }

    // Prevent spam - only allow resend every 60 seconds
    const now = Date.now();
    if (lastResendTime && now - lastResendTime < 60000) {
      const remainingTime = Math.ceil((60000 - (now - lastResendTime)) / 1000);
      toast.info(`Please wait ${remainingTime} seconds before requesting another verification email.`);
      return;
    }

    setIsResending(true);
    setResendStatus('idle');

    try {
      console.log('Attempting to resend verification email to:', userEmail);

      // Log supabase URL for sanity (dev-friendly)
      const supabaseUrl =
        typeof import.meta !== 'undefined' && (import.meta as any).env
          ? (import.meta as any).env.VITE_SUPABASE_URL
          : 'unknown';
      console.log('Supabase URL:', supabaseUrl);
      console.log('Using resend with type: signup');

      // 1) Re-check current auth state. If already verified, don't call resend.
      const { data: userResp, error: getUserErr } = await supabase.auth.getUser();
      if (getUserErr) {
        console.error('getUser error:', getUserErr);
        throw getUserErr;
      }
      const alreadyVerified = !!userResp?.user?.email_confirmed_at;
      if (alreadyVerified) {
        console.log('User already verified; skipping resend.');
        setResendStatus('success');
        setIsResending(false);
        return;
      }

      // 2) Do the resend. For signups, Supabase only sends if the user is unverified.
      const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email: userEmail,
      });

      if (error) {
        console.error('Resend verification error details:', {
          message: error.message,
          status: (error as any)?.status,
          name: error.name,
        });
        throw error;
      }

      console.log('Resend response:', data);
      console.log('Verification email resent successfully');
      setResendStatus('success');
      setLastResendTime(now);

      // Reset success message after 5 seconds
      setTimeout(() => setResendStatus('idle'), 5000);
    } catch (error: any) {
      console.error('Error resending verification email:', error);

      let errorMessage = 'Failed to send verification email. ';
      if (error?.message?.includes('email confirmation')) {
        errorMessage += 'Email verification may not be enabled for this project.';
      } else if (error?.message?.includes('rate limit')) {
        errorMessage += 'Too many requests. Please wait before trying again.';
      } else if (error?.status === 422) {
        errorMessage += 'Email confirmation may not be enabled in your Supabase settings.';
      } else {
        errorMessage += `Error: ${error?.message ?? 'Unknown error'}`;
      }

      setResendStatus('error');
      toast.error(errorMessage);

      // Reset error status after 5 seconds
      setTimeout(() => setResendStatus('idle'), 5000);
    } finally {
      setIsResending(false);
    }
  };

  const getStatusIcon = () => {
    switch (resendStatus) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Mail className="w-4 h-4 text-[#556B2F]" />;
    }
  };

  const getStatusMessage = () => {
    switch (resendStatus) {
      case 'success':
        return 'Verification email sent (or already verified). Check your inbox.';
      case 'error':
        return 'Failed to send verification email. Please try again.';
      default:
        return `Please verify your email address (${userEmail}) to access all features.`;
    }
  };

  const getStatusColor = () => {
    switch (resendStatus) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-[#fff8dc] border-[#c54a2c]';
    }
  };

  return (
    <Card className={`mx-4 mt-4 border-2 ${getStatusColor()} shadow-sm`}>
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <p className="text-sm text-[#2d3d1f]">
                {getStatusMessage()}
              </p>
              {resendStatus === 'idle' && (
                <p className="text-xs text-[#3c4f21] mt-1">
                  You can browse content but cannot book classes or create posts until verified.
                </p>
              )}
            </div>
          </div>

          {resendStatus !== 'success' && (
            <Button
              onClick={handleResendVerification}
              disabled={isResending}
              variant="outline"
              size="sm"
              className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6] whitespace-nowrap"
            >
              {isResending ? (
                <>
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="w-3 h-3 mr-1" />
                  Resend Email
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
