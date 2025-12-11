import type { Page } from "@/types/domain";

const normalizePathname = (pathname: string) => {
  if (typeof pathname !== "string") return "/";
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "") || "/";
};

export function resolveInitialPage(pathname: string): Page {
  const normalized = normalizePathname(pathname).toLowerCase();

  if (normalized.startsWith("/dashboard")) return "dashboard";
  if (normalized.startsWith("/profile")) return "profile";
  if (normalized.startsWith("/classes")) return "classes";
  if (normalized.startsWith("/bulletin")) return "bulletin";
  if (normalized.startsWith("/create-class")) return "create-class";

  return "home";
}
