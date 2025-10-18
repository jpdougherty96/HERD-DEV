import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import StarRating from "../components/StarRating";

const functionsBase = import.meta.env.VITE_SUPABASE_FUNCTIONS_BASE
  ?? "https://czdzjdujojcjluqcdchq.functions.supabase.co";

const ALREADY_REVIEWED_MESSAGE = "You have already reviewed this host for this class";

export default function ReviewHost() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { ok: boolean; error?: string }>(null);

  useEffect(() => {
    if (done?.ok && typeof window !== "undefined") {
      const timer = window.setTimeout(() => {
        window.location.href = "/dashboard/guestview/mybookings";
      }, 2500);
      return () => window.clearTimeout(timer);
    }
  }, [done]);

  if (!token) {
    return <div className="max-w-md mx-auto p-6">Invalid or missing review link.</div>;
  }

  const submit = async () => {
    if (rating < 1 || rating > 5) {
      alert("Please select a star rating.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch(`${functionsBase}/submit-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setDone({ ok: false, error: ALREADY_REVIEWED_MESSAGE });
        return;
      }
      if (!res.ok || json?.error) throw new Error(json?.error || "Failed to submit review");
      setDone({ ok: true });
    } catch (e: any) {
      setDone({ ok: false, error: e?.message || "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  };

  if (done?.ok) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Thanks for your review!</h1>
        <p>Your star rating has been recorded and your feedback (if any) was shared with the host.</p>
      </div>
    );
  }

  if (done && !done.ok && done.error === ALREADY_REVIEWED_MESSAGE) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Review Already Submitted</h1>
        <p>{ALREADY_REVIEWED_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Rate your host</h1>
      <p className="text-sm text-gray-600">Your comment (optional) will be emailed to the host, but only your star rating is saved.</p>

      <div>
        <StarRating value={rating} onChange={setRating} />
      </div>

      <div>
        <label htmlFor="comment" className="block text-sm font-medium mb-1">Comment (optional)</label>
        <Textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What did you enjoy? Anything we could improve?"
          rows={4}
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Review"}
        </Button>
      </div>

      {done && !done.ok && (
        <p className="text-red-600 text-sm mt-2">{done.error}</p>
      )}
    </div>
  );
}
