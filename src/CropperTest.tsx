import React, { useState } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css"; // ✅ REQUIRED CSS

export default function CropperTest() {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  return (
    <div
      style={{
        width: "100%",
        height: "500px",
        background: "#333",
        position: "relative",
      }}
    >
      <Cropper
        image="https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=800"
        crop={crop}
        zoom={zoom}
        aspect={1}
        onCropChange={setCrop}
        onZoomChange={setZoom}
      />
    </div>
  );
}
