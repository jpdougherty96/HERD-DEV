import React, { useState } from 'react';
import { Button } from './ui/button';
import { Mail, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { toast } from 'sonner@2.0.3';

type ResendVerificationButtonProps = {
  email: string;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  showStatus?: boolean;
};

export function ResendVerificationButton({ 
  email, 
  variant = 'outline', 
  size = 'default',
  className = '',
  showStatus = true
}: ResendVerificationButtonProps) {
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastResendTime, setLastResendTime] = useState<number | null>(null);

  const handleResendVerification = async () => {
    if (!email) return;

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
      console.log('ResendVerificationButton: Attempting to resend verification email to:', email);
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });

      if (error) {
        console.error('ResendVerificationButton: Resend verification error:', {
          message: error.message,
          status: error.status,
          name: error.name
        });
        throw error;
      }

      console.log('ResendVerificationButton: Verification email resent successfully');
      setResendStatus('success');
      setLastResendTime(now);
      
      if (showStatus) {
        // Reset success message after 3 seconds
        setTimeout(() => {
          setResendStatus('idle');
        }, 3000);
      }
    } catch (error: any) {
      console.error('ResendVerificationButton: Error resending verification email:', error);
      
      let errorMessage = 'Failed to send verification email. ';
      
      if (error.message?.includes('email confirmation')) {
        errorMessage += 'Email verification is not enabled for this project.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage += 'Too many requests. Please wait before trying again.';
      } else if (error.status === 422) {
        errorMessage += 'Email confirmation may not be enabled in your Supabase project settings.';
      } else {
        errorMessage += `Error: ${error.message}`;
      }
      
      setResendStatus('error');
      toast.error(errorMessage);
      
      if (showStatus) {
        // Reset error message after 3 seconds
        setTimeout(() => {
          setResendStatus('idle');
        }, 3000);
      }
    } finally {
      setIsResending(false);
    }
  };

  const getButtonContent = () => {
    if (isResending) {
      return (
        <>
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          Sending...
        </>
      );
    }

    if (showStatus) {
      switch (resendStatus) {
        case 'success':
          return (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Email Sent!
            </>
          );
        case 'error':
          return (
            <>
              <AlertCircle className="w-4 h-4 mr-2" />
              Try Again
            </>
          );
        default:
          return (
            <>
              <Mail className="w-4 h-4 mr-2" />
              Resend Verification
            </>
          );
      }
    }

    return (
      <>
        <Mail className="w-4 h-4 mr-2" />
        Resend Verification
      </>
    );
  };

  const getButtonVariant = () => {
    if (showStatus && resendStatus === 'success') return 'default';
    if (showStatus && resendStatus === 'error') return 'destructive';
    return variant;
  };

  return (
    <Button
      onClick={handleResendVerification}
      disabled={isResending || (showStatus && resendStatus === 'success')}
      variant={getButtonVariant()}
      size={size}
      className={`${className} ${variant === 'outline' ? 'border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]' : ''}`}
    >
      {getButtonContent()}
    </Button>
  );
}
