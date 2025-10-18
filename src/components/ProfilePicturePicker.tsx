import "react-easy-crop/react-easy-crop.css";
import React, { useState, useCallback, useRef } from "react";
import Cropper from "react-easy-crop";
import { Button } from "./ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import { Camera, Upload, X, Check } from "lucide-react";
import { toast } from "sonner";


interface ProfilePicturePickerProps {
  currentImage?: string;
  onImageChange: (file: File, previewUrl: string) => void;
  onRemove?: () => void;
  className?: string;
}

export function ProfilePicturePicker({
  currentImage,
  onImageChange,
  onRemove,
  className = "",
}: ProfilePicturePickerProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.info("Please select an image file.");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setImageSrc(blobUrl);
  };

  const getCroppedImg = async (): Promise<File | null> => {
    if (!imageSrc || !croppedAreaPixels) return null;
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement("canvas");
    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height
    );

    return new Promise<File | null>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        // ✅ give file a unique name to avoid overwrites in state
        resolve(new File([blob], `avatar-${Date.now()}.jpg`, { type: "image/jpeg" }));
      }, "image/jpeg");
    });
  };

  const handleSave = async () => {
    const file = await getCroppedImg();
    if (!file) {
      toast.error("❌ Failed to crop image. Try again.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    onImageChange(file, previewUrl); // ✅ send file + preview up to ProfilePage
    setImageSrc(null);
    if (fileInputRef.current) fileInputRef.current.value = ""; // reset input
  };

  const handleRemove = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    onRemove?.();
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-col items-center space-y-4">
        <div className="relative">
          <Avatar className="w-32 h-32 border-4 border-[#a8b892]">
            <AvatarImage src={currentImage || ""} alt="Profile picture" />
            <AvatarFallback className="text-2xl bg-[#f8f9f6] text-[#556B2F]">
              <Camera className="w-8 h-8" />
            </AvatarFallback>
          </Avatar>

          {currentImage && (
            <button
              onClick={handleRemove}
              className="absolute -top-2 -right-2 w-8 h-8 bg-[#c54a2c] text-white rounded-full flex items-center justify-center hover:bg-[#a83d24]"
              title="Remove image"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col items-center space-y-2">
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
          >
            <Upload className="w-4 h-4 mr-2" />
            {currentImage ? "Change Photo" : "Upload Photo"}
          </Button>
          <p className="text-sm text-[#556B2F] text-center max-w-xs">
            Upload and crop a square image for best results.
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {imageSrc && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-md flex flex-col">
            <div style={{ width: "100%", height: "400px", position: "relative" }}>
              <Cropper
                key={imageSrc}
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setImageSrc(null)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                <Check className="w-4 h-4 mr-2" /> Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
