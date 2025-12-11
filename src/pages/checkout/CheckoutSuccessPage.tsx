import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { supabase } from "../../utils/supabaseClient";

type ConfirmationState = "idle" | "skipped" | "loading" | "success" | "error";

type ConfirmBookingResponse = {
  ok: boolean;
  session: {
    id: string;
    status: string | null;
    payment_status: string | null;
    customer_email: string | null;
  } | null;
  booking: {
    id: string;
    status: string | null;
    payment_status: string | null;
    created_at: string | null;
  } | null;
};

const DASHBOARD_GUEST_BASE = "/dashboard/guestview";
const normalizeDashboardUrl = (slug: string) => `${DASHBOARD_GUEST_BASE}/${encodeURIComponent(slug)}`;

const getSessionIdFromLocation = (): string | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("session_id");
  return id && id.trim().length > 0 ? id : null;
};

export default function CheckoutSuccessPage(): JSX.Element {
  const [status, setStatus] = useState<ConfirmationState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmBookingResponse | null>(null);

  const sessionId = useMemo(() => getSessionIdFromLocation(), []);
  const bookingStatus = confirmation?.booking?.status?.toUpperCase() ?? null;
  const isPendingRequest = bookingStatus === "PENDING" || bookingStatus === "REQUESTED";
  const headingText = isPendingRequest ? "Booking request sent" : "Payment successful";
  const introText = isPendingRequest
    ? "We sent your request to the host. We’ll email you as soon as they respond, and your payment won’t be captured until then."
    : "You’re all set! We sent a confirmation email with everything you need for your class.";
  const summaryHeading = isPendingRequest ? "Request delivered to your host" : "You’re officially booked!";
  const summaryIntro = isPendingRequest
    ? "Your request details are saved in your dashboard so you can follow up or add information for the host."
    : "We saved the full details in your dashboard. Here’s a quick summary:";
  const nextSteps = isPendingRequest
    ? [
        "We’ll email you as soon as the host approves or declines the request.",
        "You can review or cancel the request anytime from your dashboard.",
        "Your payment method will only be charged once the host approves.",
      ]
    : [
        "We’ve emailed your booking confirmation and host contact information.",
        "You can manage your reservation and messages from the dashboard.",
        "If you have questions, reply to the confirmation email or reach out to HERD support.",
      ];

  useEffect(() => {
    let isCancelled = false;

    const confirmBooking = async (id: string) => {
      setStatus("loading");
      try {
        const { data, error } = await supabase.functions.invoke<ConfirmBookingResponse>("confirm-booking", {
          body: { sessionId: id },
        });

        if (isCancelled) return;

        if (error) {
          setErrorMessage(error.message ?? "We could not confirm your booking.");
          setStatus("error");
          return;
        }

        if (data) {
          setConfirmation(data);
        }

        setStatus("success");
      } catch (err) {
        if (isCancelled) return;

        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
        setStatus("error");
      }
    };

    if (!sessionId) {
      setStatus("skipped");
      return;
    }

    confirmBooking(sessionId);

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  const handleGoToBookings = () => {
    if (typeof window === "undefined") return;
    window.location.href = normalizeDashboardUrl("mybookings");
  };

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle className="h-10 w-10 text-emerald-600" aria-hidden="true" />
        </div>
        <h1 className="mt-8 text-3xl font-semibold text-neutral-900 sm:text-4xl">{headingText}</h1>
        <p className="mt-4 text-lg text-neutral-600">{introText}</p>

        {status === "loading" && (
          <div className="mt-8 flex items-center justify-center gap-3 text-neutral-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Finalizing your booking&hellip;</span>
          </div>
        )}

        {status === "error" && (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-left text-red-700">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">We ran into an issue while confirming your booking.</p>
                {errorMessage && <p className="mt-2 text-sm text-red-600">{errorMessage}</p>}
                {sessionId && (
                  <p className="mt-2 text-sm text-red-600">
                    Session ID: <span className="font-mono">{sessionId}</span>
                  </p>
                )}
                <p className="mt-3 text-sm">
                  Your payment may have gone through—please check your dashboard or contact support if this continues.
                </p>
              </div>
            </div>
          </div>
        )}

        {status === "skipped" && (
          <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-6 py-4 text-left text-amber-700">
            <p className="font-medium">We couldn&apos;t find a Stripe session in the URL.</p>
            <p className="mt-2 text-sm">
              If you completed a payment recently, you can still review your bookings from the dashboard.
            </p>
          </div>
        )}

        {confirmation?.booking && status === "success" && (
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-white px-6 py-6 text-left shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Booking confirmed</p>
            <h2 className="mt-2 text-xl font-semibold text-neutral-900">{summaryHeading}</h2>
            <p className="mt-2 text-sm text-neutral-600">{summaryIntro}</p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {confirmation.booking.status && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">Status</dt>
                  <dd className="mt-1 text-base font-semibold text-emerald-600">
                    {confirmation.booking.status}
                  </dd>
                </div>
              )}
              {confirmation.session?.customer_email && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">Confirmation email</dt>
                  <dd className="mt-1 text-base text-neutral-800">{confirmation.session.customer_email}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={handleGoToBookings}>
            Go to my bookings
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Return home
          </Button>
        </div>

        <div className="mt-12 rounded-lg border border-neutral-200 bg-white px-6 py-5 text-left shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-900">What happens next?</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-600">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
