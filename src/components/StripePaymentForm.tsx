import React, { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Shield, Lock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "../utils/supabaseClient";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string
);

type StripePaymentFormProps = {
  amount: number; // in dollars
  bookingId: string; // optional: track which booking this payment is for
  onCancel: () => void;
  className?: string;
};

export function StripePaymentForm({
  amount,
  bookingId,
  onCancel,
  className = "",
}: StripePaymentFormProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.access_token) {
        throw new Error("You must be signed in to complete checkout.");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (anonKey) {
        headers["apikey"] = anonKey;
      }

      headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch(
        "/functions/v1/create-checkout-session",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            amount: Math.round(amount * 100), // convert dollars → cents
            bookingId,
            success_url: `${window.location.origin}/success`,
            cancel_url: `${window.location.origin}/cancel`,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed to create checkout session");

      const { id } = await res.json();
      const stripe = await stripePromise;
      await stripe?.redirectToCheckout({ sessionId: id });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      toast.error("Something went wrong starting checkout.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Card className="bg-white border-[#a8b892] shadow-xl">
        <CardHeader className="bg-gradient-to-r from-[#556B2F] to-[#3c4f21] text-white">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Secure Payment
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Amount Summary */}
          <div className="bg-[#f8f9f6] rounded-lg p-4 border border-[#a8b892]">
            <div className="flex justify-between items-center">
              <span className="text-[#3c4f21] font-medium">
                Total Amount:
              </span>
              <span className="text-2xl font-bold text-[#556B2F]">
                ${amount.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-[#556B2F] mt-1">
              Processing fee included • Secure payment via Stripe
            </p>
          </div>

          {/* Security Notice */}
          <div className="flex items-center justify-center gap-2 text-sm text-[#64748b] bg-[#f8fafc] p-3 rounded-lg border border-[#e2e8f0]">
            <Lock className="w-4 h-4" />
            <span>
              Secured by <strong className="text-[#6772e5]">Stripe</strong> •
              HERD never stores your card details
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 border-[#a8b892] text-[#556B2F] hover:bg-[#f8f9f6]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCheckout}
              disabled={loading}
              className="flex-1 bg-[#556B2F] hover:bg-[#3c4f21] text-white font-semibold"
            >
              {loading ? "Redirecting..." : `Pay $${amount.toFixed(2)} Securely`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
