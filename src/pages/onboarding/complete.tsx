// src/pages/onboarding/complete.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function OnboardingComplete() {
  const navigate = useNavigate();

  useEffect(() => {
    // after a short delay, send back to profile
    setTimeout(() => {
      navigate("/profile"); 
    }, 1000);
  }, [navigate]);

  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-bold text-green-700">✅ Stripe Onboarding Complete!</h1>
      <p>Redirecting you back to your profile...</p>
    </div>
  );
}
