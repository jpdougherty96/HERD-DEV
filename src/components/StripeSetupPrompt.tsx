import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { AlertTriangle, CreditCard, Shield } from 'lucide-react';

type StripeSetupPromptProps = {
  onClose: () => void;
  onGoToProfile: () => void;
  hostName?: string;
};

export function StripeSetupPrompt({ onClose, onGoToProfile, hostName }: StripeSetupPromptProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="bg-[#ffffff] border-[#a8b892] max-w-md w-full">
        <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" />
            <CardTitle className="text-lg">Payment Setup Required</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          <div className="text-center">
            <CreditCard className="w-12 h-12 text-[#556B2F] mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-[#2d3d1f] mb-2">
              Stripe Connection Needed
            </h3>
            {hostName ? (
              <p className="text-[#556B2F] mb-4">
                The host <strong>{hostName}</strong> needs to complete their Stripe payment setup before their classes can be booked.
              </p>
            ) : (
              <p className="text-[#556B2F] mb-4">
                You need to connect your Stripe account before you can list classes or accept bookings.
              </p>
            )}
          </div>

          <div className="bg-[#f8f9f6] rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-[#2d3d1f] flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Why is this required?
            </h4>
            <ul className="text-sm text-[#556B2F] space-y-1">
              <li>• Secure payment processing through Stripe</li>
              <li>• Direct deposits to your bank account</li>
              <li>• HERD handles all payment compliance</li>
              <li>• Automatic fee collection (5% service fee)</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Close
            </Button>
            <Button
              onClick={onGoToProfile}
              className="flex-1 bg-[#556B2F] hover:bg-[#6B7F3F] text-[#f8f9f6]"
            >
              Set Up Payments
            </Button>
          </div>

          <p className="text-xs text-[#556B2F] text-center">
            Setting up payments is quick and secure through Stripe Connect
          </p>
        </CardContent>
      </Card>
    </div>
  );
}