import { useEffect, useRef, useState } from "react";
import { Button } from "./kit";

export function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || "Failed to access camera");
      });

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const takePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `receipt-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
      }
    }, "image/jpeg");
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      {error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-white">
          <div>
            <div className="mb-4 text-bad">{error}</div>
            <p className="text-sm text-ink-300">Please ensure camera permissions are granted.</p>
          </div>
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
      )}
      <div className="absolute bottom-0 flex w-full items-center justify-between bg-black/50 p-6 pb-12">
        <Button variant="ghost" className="text-white hover:text-white" onClick={onCancel}>
          Cancel
        </Button>
        {!error && (
          <button
            onClick={takePhoto}
            className="h-16 w-16 rounded-full border-4 border-ink-400 bg-white shadow-xl transition-transform active:scale-95"
          />
        )}
        <div className="w-16" />
      </div>
    </div>
  );
}
