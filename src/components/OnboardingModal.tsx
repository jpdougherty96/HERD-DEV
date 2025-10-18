import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { supabase } from "../utils/supabase/client";
import type { User } from "../App";

type OnboardingModalProps = {
  onComplete: (user: User) => void;
  authSession: any; // Supabase auth session
};

export function OnboardingModal({ onComplete, authSession }: OnboardingModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let userName = "";
    if (authSession?.user?.user_metadata?.full_name) {
      userName = authSession.user.user_metadata.full_name;
    } else if (authSession?.user?.user_metadata?.name) {
      userName = authSession.user.user_metadata.name;
    } else if (authSession?.user?.email) {
      userName = authSession.user.email
        .split("@")[0]
        .split(".")
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    setName(userName);

    // Try auto-submit if we got a name
    if (userName.trim()) {
      handleAutoSubmit(userName);
    }
  }, [authSession]);

  const handleAutoSubmit = async (userName: string) => {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const updates = {
        full_name: userName.trim(),
        email: authSession?.user?.email,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id)
        .select()
        .maybeSingle();

      if (error) throw error;

      if (data) {
        onComplete(data as User);
      } else {
        console.warn("No profile row found to update. Check trigger setup.");
        setError("Profile not found. Please contact support.");
        setLoading(false);
      }
    } catch (err: any) {
      console.error("Onboarding error:", err);
      setError(err.message || "Failed to complete onboarding");
      setLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAutoSubmit(name);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <Card className="bg-[#ffffff] border-[#a8b892] max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
            <h3 className="text-[#3c4f21] mb-2">Setting up your profile...</h3>
            <p className="text-[#556B2F] text-sm">Welcome to HERD!</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !name.trim()) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <Card className="bg-[#ffffff] border-[#a8b892] max-w-md w-full">
          <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
            <CardTitle>Welcome to HERD!</CardTitle>
            <p className="text-[#a8b892] text-sm">
              Let’s complete your profile setup
            </p>
          </CardHeader>

          <CardContent className="p-6">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-[#2d3d1f]">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={authSession?.user?.email || ""}
                  disabled
                  className="mt-1 bg-gray-100 border-[#a8b892]"
                />
              </div>

              <div>
                <Label htmlFor="name" className="text-[#2d3d1f]">
                  Full Name *
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1 bg-[#ffffff] border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
                  placeholder="Enter your full name"
                />
              </div>

              {error && (
                <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={!name.trim()}
                className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
              >
                Complete Setup
              </Button>

              <p className="text-sm text-[#3c4f21] text-center">
                You can add more details later, like farm info and Stripe
                connection for teaching classes.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
