import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Mail, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../utils/supabase/client';

type ResendVerificationHelperProps = {
  email: string;
  onClose: () => void;
};

export function ResendVerificationHelper({ email, onClose }: ResendVerificationHelperProps) {
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleResendVerification = async () => {
    setIsResending(true);
    setResendStatus('idle');

    try {
      console.log('Attempting to resend verification email to:', email);
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });

      if (error) {
        console.error('Resend verification error:', error);
        throw error;
      }

      console.log('Verification email resent successfully');
      setResendStatus('success');
      
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (error: any) {
      console.error('Error resending verification email:', error);
      setResendStatus('error');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="bg-[#ffffff] border-[#a8b892] max-w-md w-full">
        <div className="p-6">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              {resendStatus === 'success' ? (
                <CheckCircle className="w-12 h-12 text-green-600" />
              ) : resendStatus === 'error' ? (
                <AlertCircle className="w-12 h-12 text-red-600" />
              ) : (
                <Mail className="w-12 h-12 text-[#556B2F]" />
              )}
            </div>
            
            <div>
              <h3 className="text-lg font-medium text-[#2d3d1f] mb-2">
                {resendStatus === 'success' ? 'Email Sent!' : 
                 resendStatus === 'error' ? 'Send Failed' : 
                 'Verify Your Email'}
              </h3>
              
              <p className="text-sm text-[#3c4f21]">
                {resendStatus === 'success' ? 
                  `A new verification email has been sent to ${email}. Please check your inbox and spam folder.` :
                 resendStatus === 'error' ? 
                  'Failed to send verification email. Email confirmation may not be enabled for this project.' :
                  `We need to verify your email address (${email}) before you can sign in. Please check your inbox for a verification link.`
                }
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              {resendStatus !== 'success' && (
                <Button
                  onClick={handleResendVerification}
                  disabled={isResending}
                  className="bg-[#556B2F] hover:bg-[#6B7F3F] text-[#f8f9f6]"
                >
                  {isResending ? 'Sending...' : 'Resend Email'}
                </Button>
              )}
              
              <Button
                onClick={onClose}
                variant="outline"
                className="border-[#a8b892] text-[#3c4f21] hover:bg-[#f8f9f6]"
              >
                {resendStatus === 'success' ? 'Done' : 'Close'}
              </Button>
            </div>

            {resendStatus === 'idle' && (
              <p className="text-xs text-[#3c4f21]">
                Don't see the email? Check your spam folder or try resending.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}