import React, { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Upload, X, ImageIcon } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface PhotoPickerProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
  className?: string;
}

export function PhotoPicker({ 
  photos, 
  onPhotosChange, 
  maxPhotos = 5,
  className = "" 
}: PhotoPickerProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Create canvas for processing
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          
          // Set output size with aspect ratio preservation
          const maxWidth = 800;
          const maxHeight = 600;
          let { width, height } = img;
          
          // Calculate new dimensions while preserving aspect ratio
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width *= ratio;
            height *= ratio;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // Draw the resized image
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to data URL
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl);
        };
        
        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };
        
        img.src = e.target?.result as string;
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Validate total number of photos
    if (photos.length + files.length > maxPhotos) {
      toast.warning(`You can only add up to ${maxPhotos} photos total.`);
      return;
    }

    setIsProcessing(true);
    
    try {
      const newPhotos: string[] = [];
      
      for (const file of files) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          toast.info('Please select only image files.');
          continue;
        }

        const dataUrl = await processImage(file);
        newPhotos.push(dataUrl);
      }
      
      // Update photos array
      onPhotosChange([...photos, ...newPhotos]);
      
    } catch (error) {
      console.error('Error processing images:', error);
      toast.error('Failed to process one or more images. Please try again.');
    } finally {
      setIsProcessing(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    onPhotosChange(newPhotos);
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Upload Button */}
      {photos.length < maxPhotos && (
        <div className="border-2 border-dashed border-[#a8b892] rounded-lg p-4 text-center">
          <Button
            type="button"
            variant="outline"
            onClick={triggerFileSelect}
            disabled={isProcessing}
            className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                Processing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Add Photo{photos.length > 0 ? 's' : ''}
              </>
            )}
          </Button>
          <p className="text-xs text-[#556B2F] mt-2">
            JPG, PNG, GIF, WebP — larger files may take longer to process
          </p>
          <p className="text-xs text-[#6b7280]">
            {photos.length}/{maxPhotos} photos
          </p>
        </div>
      )}

      {/* Photo Preview Grid */}
      {photos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-[#556B2F]">
            <ImageIcon className="w-4 h-4" />
            <span>{photos.length} photo{photos.length > 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {photos.map((photo, index) => (
              <div key={index} className="relative group">
                <img
                  src={photo}
                  alt={`Preview ${index + 1}`}
                  className="w-full h-24 object-cover rounded-lg border border-[#a8b892]"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => removePhoto(index)}
                  className="absolute top-1 right-1 h-6 w-6 p-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                  title="Remove photo"
                  aria-label={`Remove photo ${index + 1}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file input - allow multiple */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
