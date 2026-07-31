import React, { useRef, useState } from 'react';
import { Camera, RefreshCw, CheckCircle2 } from 'lucide-react';
import { scanImage } from '../services/api';

export default function CameraScanner({ onScanSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      alert("تعذر فتح الكاميرا، يرجى التأكد من الصلاحيات.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current || loading) return;
    setLoading(true);

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    try {
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.85);
      });

      if (!blob) {
        throw new Error('تعذر التقاط الصورة');
      }

      const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
      const data = await scanImage(file);

      if (data.detected_products && data.detected_products.length > 0) {
        onScanSuccess(data.detected_products);
      } else {
        alert(data.warning || "لم يتم التعرف على منتج في الصورة");
      }
    } catch (err) {
      alert(err.message || "فشل الاتصال بسيرفر الذكاء الاصطناعي!");
    } finally {
      setLoading(false);
    }
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
        <div className="w-full flex gap-2">
          <button
            onClick={captureAndScan}
            disabled={loading}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
            {loading ? "جاري الفحص..." : "مسح المنتج بالذكاء الاصطناعي"}
          </button>
          <button
            type="button"
            onClick={stopCamera}
            className="px-4 py-3 rounded-xl bg-slate-200 text-slate-700 font-bold"
          >
            إغلاق
          </button>
        </div>
      )}
    </div>
  );
}
