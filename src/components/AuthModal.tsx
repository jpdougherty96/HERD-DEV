import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { X, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import { toast } from "sonner";
import { ensureProfilePatched, formatAuthError } from "@/utils/auth";

type AuthModalProps = {
  onClose: () => void;
  onSuccess: () => void; // call after a CONFIRMED signed-in session
};

type PasswordRequirement = {
  label: string;
  test: (password: string) => boolean;
};

const passwordRequirements: PasswordRequirement[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Contains uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "Contains lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "Contains a number", test: (p) => /\d/.test(p) },
];

export function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const [showPasswordRequirements, setShowPasswordRequirements] =
    useState(false);

  const isPasswordValid = passwordRequirements.every((req) =>
    req.test(password),
  );
  const doPasswordsMatch = password === confirmPassword;
  const isFormValid = isResetMode
    ? Boolean(email)
    : isSignUp
      ? Boolean(email && fullName.trim() && isPasswordValid && doPasswordsMatch)
      : Boolean(email && password);
  const submitLabel = isResetMode
    ? resetEmailSent
      ? "Resend Reset Email"
      : "Send Reset Email"
    : isSignUp
      ? "Create Account"
      : "Sign In";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isSignUp) {
        if (!isPasswordValid)
          throw new Error("Password does not meet requirements");
        if (!doPasswordsMatch) throw new Error("Passwords do not match");

        // Sign up via Supabase Auth. We pass full_name in metadata so your trigger
        // can pick it up and create a profiles row automatically.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}?verified=true`,
          },
        });

        if (error) throw new Error(formatAuthError(error));

        // If email confirmation is ON (recommended), session is null until they verify.
        if (data?.user && !data.session) {
          onClose();
          // Keep it simple here; your UI has a resend helper below if needed.
          toast.success(
            "Account created! Check your email for the verification link to complete registration.",
          );
          return;
        }

        // If email confirmation is OFF, user may already be signed in here.
        if (data?.session) {
          // Idempotently patch profile with name/email if missing
          await ensureProfilePatched({ fullName, email });
          onSuccess();
          return;
        }

        throw new Error("Unexpected response during account creation");
      } else {
        // Clean up any stale session to avoid "Invalid refresh token" noise in dev
        await supabase.auth.getSession().then(async ({ data }) => {
          if (!data.session) {
            await supabase.auth.signOut(); // clears any bad local tokens
          }
        });

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw new Error(formatAuthError(error));

        // If the project requires email confirmation, Supabase may block sign-in until verified.
        if (data?.user && !data.user.email_confirmed_at) {
          onClose();
          toast.warning(
            "Please verify your email address before signing in. Check your inbox for a verification link.",
          );
          return;
        }

        // Idempotently patch profile on sign-in (harmless if already set)
        const nameFromMeta =
          (data?.user?.user_metadata as any)?.full_name?.toString() ?? "";
        await ensureProfilePatched({
          fullName: nameFromMeta || fullName,
          email,
        });

        onSuccess();
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetEmailSent(false);

    try {
      if (!email.trim()) {
        throw new Error("Please enter the email associated with your account.");
      }

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/reset-password`,
        },
      );

      if (error) throw new Error(formatAuthError(error));

      setResetEmailSent(true);
      toast.success(
        "Password reset email sent! Check your inbox for the reset link.",
      );
    } catch (err: any) {
      setError(err?.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const exitResetMode = () => {
    setIsResetMode(false);
    setResetEmailSent(false);
    setError("");
  };

  const openResetMode = () => {
    setIsSignUp(false);
    setIsResetMode(true);
    setResetEmailSent(false);
    setError("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setShowPasswordRequirements(false);
  };

  const goToSignIn = () => {
    exitResetMode();
    setIsSignUp(false);
    setPassword("");
    setConfirmPassword("");
    setShowPasswordRequirements(false);
  };

  const goToSignUp = () => {
    exitResetMode();
    setIsSignUp(true);
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setShowPasswordRequirements(false);
  };

  const toggleMode = () => {
    exitResetMode();
    setIsSignUp((v) => !v);
    setError("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setShowPasswordRequirements(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <Card className="bg-white border-[#a8b892] max-w-md w-full overflow-hidden">
          <CardHeader className="bg-[#556B2F] text-[#f8f9f6] rounded-t-xl">
            <div className="flex justify-between items-center">
              <CardTitle className="text-[#f8f9f6]">
                {isSignUp ? "Create Account" : "Sign In"}
              </CardTitle>
              <Button
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
            <form
              onSubmit={isResetMode ? handlePasswordResetSubmit : handleSubmit}
              className="space-y-4"
            >
              {isResetMode ? (
                <>
                  <div className="space-y-2 text-sm text-[#2d3d1f]">
                    <p>Forgot your password? No worries.</p>
                    <p>
                      Enter the email associated with your account and
                      we&apos;ll send you a secure link to set a new password.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="resetEmail" className="text-[#2d3d1f]">
                      Email
                    </Label>
                    <Input
                      id="resetEmail"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
                      placeholder="Enter your email"
                    />
                  </div>

                  {resetEmailSent && (
                    <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
                      Reset instructions were sent to <strong>{email}</strong>.
                      Check your inbox (and spam folder) for the link.
                    </div>
                  )}

                  {error && (
                    <div className="text-red-600 text-sm bg-red-50 p-2 rounded flex items-center whitespace-pre-line">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading || !isFormValid}
                    className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Sending..." : submitLabel}
                  </Button>

                  <div className="text-center space-y-2">
                    <button
                      type="button"
                      onClick={goToSignIn}
                      className="text-[#556B2F] hover:underline"
                    >
                      Remembered your password? Sign in
                    </button>
                    <button
                      type="button"
                      onClick={goToSignUp}
                      className="text-[#556B2F] hover:underline"
                    >
                      Need an account? Create one
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {isSignUp && (
                    <div>
                      <Label htmlFor="fullName" className="text-[#2d3d1f]">
                        Full Name
                      </Label>
                      <Input
                        id="fullName"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
                        placeholder="Enter your full name"
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="email" className="text-[#2d3d1f]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F]"
                      placeholder="Enter your email"
                    />
                  </div>

                  <div>
                    <Label htmlFor="password" className="text-[#2d3d1f]">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() =>
                          isSignUp && setShowPasswordRequirements(true)
                        }
                        required
                        className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F] pr-10"
                        placeholder="Enter your password"
                        minLength={isSignUp ? 8 : 6}
                        autoComplete={
                          isSignUp ? "new-password" : "current-password"
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-auto p-1 text-[#556B2F] hover:bg-transparent"
                      >
                        {showPassword ? (
                          <Eye className="w-4 h-4" />
                        ) : (
                          <EyeOff className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {!isSignUp && (
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={openResetMode}
                        className="text-sm text-[#556B2F] hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}

                  {isSignUp && (
                    <div>
                      <Label
                        htmlFor="confirmPassword"
                        className="text-[#2d3d1f]"
                      >
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="mt-1 bg-white border-[#a8b892] focus:border-[#556B2F] focus:ring-[#556B2F] pr-10"
                          placeholder="Confirm your password"
                          autoComplete="new-password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setShowConfirmPassword(!showConfirmPassword)
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-auto p-1 text-[#556B2F] hover:bg-transparent"
                        >
                          {showConfirmPassword ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                      {confirmPassword && !doPasswordsMatch && (
                        <p className="text-red-600 text-sm mt-1 flex items-center">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Passwords do not match
                        </p>
                      )}
                    </div>
                  )}

                  {isSignUp && showPasswordRequirements && (
                    <div className="bg-[#f8f9f6] border border-[#a8b892] rounded-lg p-3">
                      <p className="text-sm text-[#2d3d1f] mb-2">
                        Password requirements:
                      </p>
                      <div className="space-y-1">
                        {passwordRequirements.map((req, index) => (
                          <div
                            key={index}
                            className="flex items-center text-xs"
                          >
                            <Check
                              className={`w-3 h-3 mr-2 ${req.test(password) ? "text-green-600" : "text-gray-400"}`}
                            />
                            <span
                              className={
                                req.test(password)
                                  ? "text-green-600"
                                  : "text-[#3c4f21]"
                              }
                            >
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

                  <Button
                    type="submit"
                    disabled={loading || !isFormValid}
                    className="w-full bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Loading..." : submitLabel}
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={toggleMode}
                      className="text-[#556B2F] hover:underline"
                    >
                      {isSignUp
                        ? "Already have an account? Sign in"
                        : "Don't have an account? Sign up"}
                    </button>
                  </div>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
