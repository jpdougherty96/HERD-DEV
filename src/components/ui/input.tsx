import * as React from "react";
import { cn } from "./utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // ✅ HERD unified fine-line gray border
        "w-full h-10 rounded-md border-[0.5px] border-[#d1d5db] bg-white text-[#1f2b15] placeholder:text-[#6b7280] px-3",
        "focus:border-black focus:ring-0 focus-visible:ring-4 focus-visible:ring-[#c54a2c]/30",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:cursor-not-allowed disabled:opacity-50 transition-all",
        className
      )}
      {...props}
    />
  );
}

export { Input };
