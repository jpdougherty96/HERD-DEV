import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { toast } from 'sonner@2.0.3';

interface ImageCropperModalProps {
  imageUrl: string;
  onCrop: (croppedImageUrl: string) => void;
  onCancel: () => void;
  wasHEICConverted?: boolean;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ImageCropperModal({ imageUrl, onCrop, onCancel, wasHEICConverted = false }: ImageCropperModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [cropArea, setCropArea] = useState<CropArea>({ x: 50, y: 50, width: 200, height: 200 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string>('');
  
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (isDragging) {
        const deltaX = x - dragStart.x;
        const deltaY = y - dragStart.y;
        
        setCropArea(prev => ({
          ...prev,
          x: Math.max(0, Math.min(imageDimensions.width - prev.width, prev.x + deltaX)),
          y: Math.max(0, Math.min(imageDimensions.height - prev.height, prev.y + deltaY))
        }));
        
        setDragStart({ x, y });
      } else if (isResizing) {
        handleResize(x, y);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle('');
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, imageDimensions, resizeHandle]);

  const handleResize = (mouseX: number, mouseY: number) => {
    setCropArea(prev => {
      let newArea = { ...prev };
      const minSize = 50;
      
      if (resizeHandle.includes('right')) {
        newArea.width = Math.max(minSize, Math.min(imageDimensions.width - prev.x, mouseX - prev.x));
      }
      if (resizeHandle.includes('left')) {
        const newWidth = Math.max(minSize, prev.width + (prev.x - mouseX));
        const newX = prev.x + prev.width - newWidth;
        if (newX >= 0) {
          newArea.x = newX;
          newArea.width = newWidth;
        }
      }
      if (resizeHandle.includes('bottom')) {
        newArea.height = Math.max(minSize, Math.min(imageDimensions.height - prev.y, mouseY - prev.y));
      }
      if (resizeHandle.includes('top')) {
        const newHeight = Math.max(minSize, prev.height + (prev.y - mouseY));
        const newY = prev.y + prev.height - newHeight;
        if (newY >= 0) {
          newArea.y = newY;
          newArea.height = newHeight;
        }
      }
      
      return newArea;
    });
  };

  const handleMouseDown = (e: React.MouseEvent, action: 'drag' | 'resize', handle?: string) => {
    e.preventDefault();
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (action === 'drag') {
      setIsDragging(true);
      setDragStart({ x, y });
    } else if (action === 'resize' && handle) {
      setIsResizing(true);
      setResizeHandle(handle);
    }
  };

  const handleCrop = useCallback(async () => {
    if (!imgRef.current || !canvasRef.current || !imageLoaded) return;
    
    setIsProcessing(true);
    
    try {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Calculate scale factors
      const displayWidth = img.clientWidth;
      const displayHeight = img.clientHeight;
      const scaleX = img.naturalWidth / displayWidth;
      const scaleY = img.naturalHeight / displayHeight;

      // Calculate actual crop dimensions
      const actualCropX = cropArea.x * scaleX;
      const actualCropY = cropArea.y * scaleY;
      const actualCropWidth = cropArea.width * scaleX;
      const actualCropHeight = cropArea.height * scaleY;

      // Set canvas size for profile picture (square, reasonable size)
      const outputSize = 400; // 400x400 for profile pictures
      canvas.width = outputSize;
      canvas.height = outputSize;
      
      // Draw the cropped image
      ctx.drawImage(
        img,
        actualCropX, actualCropY, actualCropWidth, actualCropHeight,
        0, 0, outputSize, outputSize
      );
      
      // Convert canvas to data URL (more reliable than blob URLs)
      const croppedImageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      console.log('Image cropped successfully, data URL length:', croppedImageDataUrl.length);
      onCrop(croppedImageDataUrl);
      setIsProcessing(false);
      
    } catch (error) {
      console.error('Error cropping image:', error);
      toast.error('Failed to process image. Please try again.');
      setIsProcessing(false);
    }
  }, [onCrop, cropArea, imageLoaded]);

  const handleImageLoad = () => {
    console.log('🖼️ Image loaded in cropper successfully');
    
    // Use setTimeout to ensure the image is fully rendered before we process it
    setTimeout(() => {
      setImageLoading(false);
      
      if (imgRef.current) {
        const displayWidth = imgRef.current.clientWidth;
        const displayHeight = imgRef.current.clientHeight;
        const naturalWidth = imgRef.current.naturalWidth;
        const naturalHeight = imgRef.current.naturalHeight;
        
        console.log('🖼️ Image dimensions:', {
          display: { width: displayWidth, height: displayHeight },
          natural: { width: naturalWidth, height: naturalHeight }
        });
        
        // Only proceed if we have valid dimensions
        if (displayWidth > 0 && displayHeight > 0) {
          setImageDimensions({ width: displayWidth, height: displayHeight });
          
          // Set initial crop area to center square
          const size = Math.min(displayWidth, displayHeight) * 0.6;
          const x = (displayWidth - size) / 2;
          const y = (displayHeight - size) / 2;
          
          console.log('🎯 Setting initial crop area:', { x, y, width: size, height: size });
          setCropArea({ x, y, width: size, height: size });
          setImageLoaded(true);
          
          console.log('✅ Image cropper fully initialized');
        } else {
          console.warn('❌ Image dimensions are invalid:', { displayWidth, displayHeight });
          // Try again after a short delay
          setTimeout(() => handleImageLoad(), 100);
        }
      }
    }, 50); // Small delay to ensure rendering is complete
  };

  const handleImageError = () => {
    console.error('❌ Failed to load image in cropper:', imageUrl.substring(0, 50) + '...');
    setImageLoading(false);
    toast.error('Failed to load image for cropping. This might be due to an unsupported format, corrupted file, or browser issue. Please try a different JPEG or PNG image.');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="bg-[#ffffff] border-[#a8b892] max-w-4xl w-full max-h-[90vh] overflow-auto">
        <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
          <CardTitle>Crop Profile Picture</CardTitle>
          <p className="text-[#a8b892] text-sm">
            Drag to move the crop area, resize by dragging the corners. The cropped area will be used as your profile picture.
            {wasHEICConverted && (
              <span className="block mt-1 text-green-300">
                ✓ HEIC image successfully converted to JPEG
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex justify-center">
              <div 
                ref={containerRef}
                className="relative inline-block border-2 border-[#a8b892] rounded-lg overflow-hidden"
                style={{ 
                  userSelect: 'none',
                  maxWidth: '100%',
                  maxHeight: '400px',
                  minWidth: '300px',
                  minHeight: '200px',
                  backgroundColor: imageLoaded ? 'transparent' : '#f9f9f9'
                }}
              >
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#556B2F] mx-auto mb-2"></div>
                      <p className="text-[#556B2F] text-sm">Loading image...</p>
                    </div>
                  </div>
                )}
                <img
                  ref={imgRef}
                  alt="Preview"
                  src={imageUrl}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  className="block max-w-full max-h-96 object-contain pointer-events-none"
                  draggable={false}
                  style={{
                    width: 'auto',
                    height: 'auto',
                    maxWidth: '500px',
                    maxHeight: '400px',
                    display: 'block',
                    opacity: imageLoaded ? 1 : 0.1, // Show very faint image even when "loading"
                    transition: 'opacity 0.3s ease',
                    backgroundColor: '#f0f0f0', // Light background to see if element is there
                    border: '1px solid #ddd' // Visible border to see element bounds
                  }}
                />
                
                {/* Emergency fallback - show image URL as background if img element fails */}
                {!imageLoaded && !imageLoading && (
                  <div 
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-50"
                    style={{ backgroundImage: `url(${imageUrl})` }}
                  />
                )}
                
                {/* Crop overlay */}
                {imageLoaded && (
                  <>
                    {/* Dark overlay for non-cropped areas */}
                    <div className="absolute inset-0 bg-black bg-opacity-40 pointer-events-none" />
                    
                    {/* Crop area */}
                    <div
                      className="absolute border-2 border-white shadow-lg cursor-move bg-transparent"
                      style={{
                        left: cropArea.x,
                        top: cropArea.y,
                        width: cropArea.width,
                        height: cropArea.height,
                      }}
                      onMouseDown={(e) => handleMouseDown(e, 'drag')}
                    >
                      {/* Clear the dark overlay inside crop area */}
                      <div className="absolute inset-0 bg-black bg-opacity-0" />
                      
                      {/* Grid lines */}
                      <div className="absolute inset-0 border border-white border-opacity-30">
                        <div className="absolute top-1/3 left-0 right-0 border-t border-white border-opacity-30" />
                        <div className="absolute top-2/3 left-0 right-0 border-t border-white border-opacity-30" />
                        <div className="absolute left-1/3 top-0 bottom-0 border-l border-white border-opacity-30" />
                        <div className="absolute left-2/3 top-0 bottom-0 border-l border-white border-opacity-30" />
                      </div>
                      
                      {/* Resize handles */}
                      <div className="absolute -top-1 -left-1 w-3 h-3 bg-white border border-gray-400 cursor-nw-resize"
                        onMouseDown={(e) => handleMouseDown(e, 'resize', 'top-left')} />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-white border border-gray-400 cursor-ne-resize"
                        onMouseDown={(e) => handleMouseDown(e, 'resize', 'top-right')} />
                      <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-white border border-gray-400 cursor-sw-resize"
                        onMouseDown={(e) => handleMouseDown(e, 'resize', 'bottom-left')} />
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-white border border-gray-400 cursor-se-resize"
                        onMouseDown={(e) => handleMouseDown(e, 'resize', 'bottom-right')} />
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Instructions */}
            {imageLoaded && (
              <div className="text-center text-sm text-[#556B2F] bg-[#f8f9f6] rounded p-3">
                <p><strong>Instructions:</strong></p>
                <p>• Drag the white square to position your crop area</p>
                <p>• Drag the corner handles to resize the crop area</p>
                <p>• The final image will be square (400x400 pixels)</p>
              </div>
            )}
            
            {/* Debug info for development */}
            {typeof import.meta !== 'undefined' && import.meta.env?.DEV && (
              <div className="text-xs text-gray-600 bg-gray-100 rounded p-2">
                <p><strong>Debug Info:</strong></p>
                <p>Loading: {imageLoading ? 'Yes' : 'No'}</p>
                <p>Loaded: {imageLoaded ? 'Yes' : 'No'}</p>
                <p>Image URL: {imageUrl.substring(0, 30)}...</p>
                <p>Dimensions: {imageDimensions.width}x{imageDimensions.height}</p>
                <p>Crop: {Math.round(cropArea.x)},{Math.round(cropArea.y)} {Math.round(cropArea.width)}x{Math.round(cropArea.height)}</p>
                <div className="mt-2">
                  <button
                    onClick={() => {
                      console.log('🔧 Manual image visibility debug:', {
                        imageLoaded,
                        imageLoading,
                        imgRef: !!imgRef.current,
                        imgSrc: imgRef.current?.src,
                        imgNaturalDimensions: imgRef.current ? `${imgRef.current.naturalWidth}x${imgRef.current.naturalHeight}` : 'N/A',
                        imgDisplayDimensions: imgRef.current ? `${imgRef.current.clientWidth}x${imgRef.current.clientHeight}` : 'N/A'
                      });
                      
                      // Force show image if it's loaded but not visible
                      if (imgRef.current && !imageLoaded) {
                        console.log('🔧 Force setting image to visible');
                        setImageLoaded(true);
                        setImageLoading(false);
                      }
                    }}
                    className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                  >
                    Debug Image
                  </button>
                </div>
              </div>
            )}
            
            {/* Hidden canvas for processing */}
            <canvas
              ref={canvasRef}
              style={{ display: 'none' }}
            />

            <div className="flex gap-3">
              <Button
                onClick={handleCrop}
                disabled={isProcessing || !imageLoaded}
                className="flex-1 bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
              >
                {isProcessing ? 'Processing...' : 'Crop & Save'}
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={isProcessing}
                className="flex-1 border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-[#f8f9f6]"
              >
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}