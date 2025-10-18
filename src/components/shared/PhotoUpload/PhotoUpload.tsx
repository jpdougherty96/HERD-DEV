import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/components/ui/utils";

export type PhotoUploadAdapter = {
  processFiles: (files: File[]) => Promise<string[]>;
  remove?: (url: string) => Promise<void> | void;
};

interface PhotoUploadProps {
  value: string[];
  onChange: (photos: string[]) => void;
  adapter: PhotoUploadAdapter;
  maxPhotos?: number;
  className?: string;
}

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  value,
  onChange,
  adapter,
  maxPhotos = 8,
  className,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (value.length >= maxPhotos) {
      toast.info(`You can only upload up to ${maxPhotos} photos.`);
      return;
    }

    setIsUploading(true);
    try {
      const remaining = maxPhotos - value.length;
      const selected = Array.from(files).slice(0, remaining);
      const newUrls = await adapter.processFiles(selected);
      if (newUrls.length > 0) onChange([...value, ...newUrls]);
    } catch (err) {
      console.error(err);
      toast.error("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = async (idx: number) => {
    const url = value[idx];
    onChange(value.filter((_, i) => i !== idx));
    try {
      if (adapter.remove) await adapter.remove(url);
    } catch {
      console.warn("Failed to remove file:", url);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Label className="text-[#2d3d1f]">Upload Photos (max {maxPhotos})</Label>

      {value.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {value.map((photo, i) => (
            <div key={i} className="relative group">
              <img
                src={photo}
                alt={`photo ${i}`}
                className="w-full h-24 object-cover rounded-lg border border-[#a8b892]"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => handleRemove(i)}
                className="absolute top-1 right-1 w-6 h-6 p-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-red-500 hover:bg-red-600"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {value.length < maxPhotos && (
        <div className="border-2 border-dashed border-[#a8b892] rounded-lg p-6 text-center bg-white hover:border-[#556B2F] transition-colors">
          <Camera className="w-12 h-12 text-[#556B2F] mx-auto mb-4" />
          <p className="text-[#3c4f21] mb-2">
            Add photos of your homestead and class area
            {value.length > 0 && (
              <span className="block text-sm text-[#556B2F] mt-1">
                {value.length}/{maxPhotos} uploaded
              </span>
            )}
          </p>
          <Button
            type="button"
            className="bg-[#556B2F] text-[#f8f9f6] hover:bg-[#3c4f21]"
            disabled={isUploading}
            onClick={() => !isUploading && fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            {isUploading ? "Uploading..." : "Choose Photos"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleSelect}
          />
        </div>
      )}

      {value.length >= maxPhotos && (
        <div className="p-4 bg-[#f8f9f6] border border-[#a8b892] rounded-lg text-center">
          <p className="text-[#3c4f21]">Maximum of {maxPhotos} photos reached</p>
        </div>
      )}
    </div>
  );
};
