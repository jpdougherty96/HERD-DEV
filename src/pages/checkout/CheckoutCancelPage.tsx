import { useMemo } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";

const getSessionIdFromLocation = (): string | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("session_id");
  return id && id.trim().length > 0 ? id : null;
};

export default function CheckoutCancelPage(): JSX.Element {
  const sessionId = useMemo(() => getSessionIdFromLocation(), []);

  const handleRetry = () => {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/classes";
  };

  const handleReturnHome = () => {
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-10 w-10 text-amber-600" aria-hidden="true" />
        </div>
        <h1 className="mt-8 text-3xl font-semibold text-neutral-900 sm:text-4xl">Payment canceled</h1>
        <p className="mt-4 text-lg text-neutral-600">
          Your booking wasn&apos;t completed. You can try the checkout again or continue browsing HERD classes.
        </p>

        {sessionId && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-6 py-4 text-left text-sm text-amber-700">
            <p className="font-medium">Stripe session ID</p>
            <p className="mt-1 font-mono text-xs">{sessionId}</p>
          </div>
        )}

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={handleRetry} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry checkout
          </Button>
          <Button variant="outline" size="lg" onClick={handleReturnHome} className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Return home
          </Button>
        </div>

        <div className="mt-12 rounded-lg border border-neutral-200 bg-white px-6 py-5 text-left shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-900">Need help?</h2>
          <p className="mt-3 text-sm text-neutral-600">
            If you ran into issues with payment, you can update your payment method and try again from your dashboard.
            We&apos;re happy to help if you reach out to HERD support.
          </p>
        </div>
      </div>
    </div>
  );
}
