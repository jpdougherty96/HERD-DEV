import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PhotoLightboxProps = {
  photos: string[];
  open: boolean;
  startIndex?: number;
  onClose: () => void;
  title?: string;
  onIndexChange?: (index: number) => void;
};

const clampIndex = (photos: string[], index: number) => {
  if (!photos.length) return 0;
  if (index < 0) return photos.length - 1;
  if (index >= photos.length) return 0;
  return index;
};

export function PhotoLightbox({
  photos,
  open,
  startIndex = 0,
  onClose,
  title,
  onIndexChange,
}: PhotoLightboxProps) {
  const safePhotos = useMemo(
    () => (Array.isArray(photos) ? photos.filter(Boolean) : []),
    [photos]
  );

  const [currentIndex, setCurrentIndex] = useState(() =>
    clampIndex(safePhotos, startIndex)
  );

  useLayoutEffect(() => {
    if (!open) return;
    setCurrentIndex(clampIndex(safePhotos, startIndex));
  }, [open, startIndex, safePhotos]);

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => clampIndex(safePhotos, prev + 1));
  }, [safePhotos]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => clampIndex(safePhotos, prev - 1));
  }, [safePhotos]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (!safePhotos.length) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, goNext, goPrev, safePhotos.length]);

  useEffect(() => {
    if (!onIndexChange || !open) return;
    onIndexChange(currentIndex);
  }, [currentIndex, onIndexChange, open]);

  if (!safePhotos.length) return null;

  const currentPhoto = safePhotos[currentIndex] ?? safePhotos[0];
  const hasMultiple = safePhotos.length > 1;

  return (
    <Dialog open={open} onOpenChange={(value: boolean) => (!value ? onClose() : undefined)}>
      <DialogContent
        className="max-w-[90vw] sm:max-w-[85vw] md:max-w-[80vw] lg:max-w-[70vw] xl:max-w-[65vw] w-full border-none bg-transparent p-0 shadow-none [&>button]:text-white"
        aria-describedby={undefined} // ✅ silences missing description warning
      >
        {/* ✅ Add hidden a11y title + optional description */}
        <VisuallyHidden>
          <DialogTitle>{title || "Photo Lightbox"}</DialogTitle>
          <DialogDescription>
            Use arrow keys or buttons to navigate between photos.
          </DialogDescription>
        </VisuallyHidden>

        <div className="relative flex h-[80vh] w-full items-center justify-center overflow-hidden rounded-lg bg-black">
          {hasMultiple && (
            <Button
              variant="ghost"
              size="icon"
              onClick={goPrev}
              className="absolute left-4 z-10 size-10 rounded-full bg-black/50 text-white transition hover:bg-black/70"
            >
              <ChevronLeft className="size-6" />
            </Button>
          )}

          <img
            key={`${currentIndex}-${currentPhoto}`}
            src={currentPhoto}
            alt={
              title
                ? `${title} photo ${currentIndex + 1}`
                : `Photo ${currentIndex + 1}`
            }
            className="max-h-full max-w-full object-contain"
          />

          {hasMultiple && (
            <Button
              variant="ghost"
              size="icon"
              onClick={goNext}
              className="absolute right-4 z-10 size-10 rounded-full bg-black/50 text-white transition hover:bg-black/70"
            >
              <ChevronRight className="size-6" />
            </Button>
          )}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1 text-xs font-medium text-white">
            {currentIndex + 1} / {safePhotos.length}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
