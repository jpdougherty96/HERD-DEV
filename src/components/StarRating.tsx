import React from "react";

type Props = {
  value: number;
  onChange: (n: number) => void;
  size?: number;
};

export default function StarRating({ value, onChange, size = 28 }: Props) {
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          title={`${n} star${n>1?"s":""}`}
          className="p-0.5"
          aria-label={`Set rating to ${n}`}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={n <= value ? "currentColor" : "none"}
            stroke="currentColor"
            className={n <= value ? "text-yellow-500" : "text-gray-400"}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M11.48 3.499a.562.562 0 011.04 0l2.017 5.143a.563.563 0 00.475.353l5.514.401a.562.562 0 01.319.98l-4.204 3.62a.563.563 0 00-.182.557l1.285 5.407a.562.562 0 01-.84.61l-4.727-2.77a.563.563 0 00-.586 0l-4.727 2.77a.562.562 0 01-.84-.61l1.285-5.407a.563.563 0 00-.182-.557l-4.204-3.62a.562.562 0 01.319-.98l5.514-.401a.563.563 0 00.475-.353L11.48 3.5z"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
