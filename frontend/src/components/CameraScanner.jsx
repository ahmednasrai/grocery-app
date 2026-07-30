import React, { useRef, useState } from 'react';
import { Camera, RefreshCw, CheckCircle2 } from 'lucide-react';

export default function CameraScanner({ onScanSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      alert("تعذر فتح الكاميرا، يرجى التأكد من الصلاحيات.");
    }
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setLoading(true);

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      try {
        const response = await fetch('http://localhost:8000/api/scan', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (data.detected_products && data.detected_products.length > 0) {
          onScanSuccess(data.detected_products);
        } else {
          alert("لم يتم التعرف على منتج في الصورة");
        }
      } catch (err) {
        alert("فشل الاتصال بسيرفر الذكاء الاصطناعي!");
      }
      setLoading(false);
    }, 'image/jpeg');
  };

  return (
    <div className="bg-white p-4 rounded-2xl border shadow-sm flex flex-col items-center space-y-4">
      <div className="relative w-full h-64 bg-black rounded-xl overflow-hidden flex items-center justify-center">
        {!isCameraActive ? (
          <button onClick={startCamera} className="bg-blue-600 text-white px-4 py-2 rounded-xl flex items-center gap-2">
            <Camera size={20} /> تشغيل الكاميرا
          </button>
        ) : (
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive && (
        <button onClick={captureAndScan} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
          {loading ? <RefreshCw className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
          {loading ? "جاري الفحص..." : "مسح المنتج بالذكاء الاصطناعي"}
        </button>
      )}
    </div>
  );
}