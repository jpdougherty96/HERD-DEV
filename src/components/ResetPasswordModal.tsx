import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Eye, EyeOff, Check, AlertCircle, X } from "lucide-react";
import { supabase } from "../utils/supabaseClient";
import { toast } from "sonner";


type ResetPasswordModalProps = {
  email?: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

const passwordRequirements = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "Contains uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Contains lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Contains a number", test: (p: string) => /\d/.test(p) },
];

function formatResetError(error: any) {
  const message = String(error?.message ?? "");
  if (!message) return "Unable to update password. Please try again.";
  if (message.toLowerCase().includes("password")) return message;
  return `${message}. Please try again or contact support.`;
}

export function ResetPasswordModal({
  email,
  onClose,
  onSuccess,
}: ResetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isPasswordValid = passwordRequirements.every((req) => req.test(password));
  const doPasswordsMatch = password === confirmPassword;
  const canSubmit =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    isPasswordValid &&
    doPasswordsMatch;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError("");

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        throw new Error(formatResetError(updateError));
      }

      toast.success("Password updated successfully! You can continue using HERD.");
      setPassword("");
      setConfirmPassword("");
      setShowRequirements(false);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Unable to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="bg-white border-[#a8b892] max-w-md w-full">
        <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
          <div className="flex items-center justify-between">
            <CardTitle>Reset Your Password</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[#f8f9f6] hover:bg-[#6B7F3F]"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2 text-sm text-[#2d3d1f]">
              <p>
                {`You're almost done! ${
                  email ? `Finish resetting the password for ${email}.` : "Enter a new password to finish resetting your account."
                }`}
              </p>
              <p>
                Your password should be strong enough to protect your account.
                Use at least one uppercase letter, one lowercase letter, and a number.
              </p>
            </div>

            <div>
              <Label htmlFor="new-password" className="text-[#2d3d1f]">
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setShowRequirements(true)}
                  className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F] pr-10"
                  placeholder="Enter a new password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-auto p-1 text-[#556B2F] hover:bg-transparent"
                >
                  {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirm-password" className="text-[#2d3d1f]">
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F] pr-10"
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-auto p-1 text-[#556B2F] hover:bg-transparent"
                >
                  {showConfirmPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
              </div>

              {confirmPassword && !doPasswordsMatch && (
                <p className="text-red-600 text-sm mt-1 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Passwords do not match
                </p>
              )}
            </div>

            {showRequirements && (
              <div className="bg-[#f8f9f6] border border-[#a8b892] rounded-lg p-3">
                <p className="text-sm text-[#2d3d1f] mb-2">Password requirements:</p>
                <div className="space-y-1">
                  {passwordRequirements.map((req, index) => (
                    <div key={index} className="flex items-center text-xs">
                      <Check className={`w-3 h-3 mr-2 ${req.test(password) ? "text-green-600" : "text-gray-400"}`} />
                      <span className={req.test(password) ? "text-green-600" : "text-[#3c4f21]"}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="text-red-600 text-sm bg-red-50 p-2 rounded flex items-center whitespace-pre-line">
                <AlertCircle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={loading || !canSubmit}
                className="flex-1 bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Updating..." : "Save New Password"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
