import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "./ui";

export function QRScanner({ onCode, startLabel, stopLabel, unavailableLabel }: { onCode: (code: string) => void; startLabel: string; stopLabel: string; unavailableLabel: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { controls.current?.stop(); }, []);

  async function start() {
    if (!video.current || !navigator.mediaDevices?.getUserMedia) { setError(unavailableLabel); return; }
    try {
      setError("");
      const reader = new BrowserQRCodeReader();
      controls.current = await reader.decodeFromVideoDevice(undefined, video.current, (result) => {
        if (result) {
          onCode(result.getText());
          controls.current?.stop();
          setRunning(false);
        }
      });
      setRunning(true);
    } catch {
      setError(unavailableLabel);
      setRunning(false);
    }
  }

  function stop() {
    controls.current?.stop();
    controls.current = null;
    setRunning(false);
  }

  return <div className="scanner-wrap">
    <video ref={video} className={`scanner-video ${running ? "visible" : ""}`} muted playsInline />
    <Button type="button" variant="outline" icon={running ? CameraOff : Camera} onClick={() => running ? stop() : void start()}>{running ? stopLabel : startLabel}</Button>
    {error && <small className="field-error">{error}</small>}
  </div>;
}
