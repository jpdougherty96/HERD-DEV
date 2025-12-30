import React from "react";

type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full border-b-2 border-[#556B2F] ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
