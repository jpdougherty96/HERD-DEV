import * as React from "react";
import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // ✅ HERD unified field style (fine 0.5px gray border)
        "w-full min-h-[140px] rounded-md border-[0.5px] border-[#d1d5db] bg-white text-[#1f2b15] placeholder:text-[#6b7280] px-3 py-2",
        "focus:border-black focus:ring-0 focus-visible:ring-4 focus-visible:ring-[#c54a2c]/30",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:cursor-not-allowed disabled:opacity-50 transition-all resize-none",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
