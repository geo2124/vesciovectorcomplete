import React, { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Modal, Button } from "@/components/kit";
import { useDB, findPlayerNextSession, getPlayerMonthlyPresentCount } from "@/lib/data-store";
import type { Player, SessionItem } from "@/lib/mock-data";
import { playCheckInFeedback, playBlockedBuzzerFeedback } from "@/lib/audio-feedback";
import { calculatePlayer30DayAttendance } from "@/lib/attendance-utils";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Volume2,
  VolumeX,
  Zap,
  RefreshCw,
  ShieldAlert,
  Upload,
  User,
  CalendarCheck,
} from "lucide-react";
import { toast } from "sonner";
import { dispatchAttendanceGuardrailAlert } from "@/lib/notifications";

interface QrAttendanceScannerProps {
  open: boolean;
  onClose: () => void;
  session?: SessionItem | null;
  defaultSessionId?: string;
  roster?: Player[];
  onCheckIn?: (player: Player, status: "Present" | "Absent" | "Excused") => void;
}

interface ScanEvent {
  id: string;
  type: "success" | "warning" | "error" | "duplicate";
  title: string;
  subtitle: string;
  player?: Player;
  timestamp: string;
  timeStr: string;
  rawText?: string;
}

export function QrAttendanceScanner({
  open,
  onClose,
  session = null,
  defaultSessionId,
  roster = [],
  onCheckIn,
}: QrAttendanceScannerProps) {
  const { db, recordAttendance, tenantId } = useDB();

  // Scanner state
  const [continuousMode, setContinuousMode] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScanEvent, setLastScanEvent] = useState<ScanEvent | null>(null);
  const [recentScans, setRecentScans] = useState<ScanEvent[]>([]);
  const [blockedPlayerDialog, setBlockedPlayerDialog] = useState<{
    player: Player;
    status: string;
    reason: string;
    timeStr: string;
  } | null>(null);

  // Manual fallback state
  const [manualQuery, setManualQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"camera" | "manual">("camera");

  const scannerRef = useRef<{
    scanFile: (file: File, showImage?: boolean) => Promise<string>;
    start: (...args: unknown[]) => Promise<unknown>;
    stop: () => Promise<void>;
    clear: () => void;
    isScanning: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentScanCooldownRef = useRef<Record<string, number>>({});
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resolvedSession =
    session ||
    (defaultSessionId ? db.sessions.find((s) => s.id === defaultSessionId) || null : null);
  const sessionId = resolvedSession?.id || defaultSessionId || "";

  // Stop the camera cleanly
  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (err) {
        console.debug("Camera stop error:", err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Process scanned text
  const handleScannedResult = useCallback(
    async (decodedText: string) => {
      const now = Date.now();
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      // Throttle scanning the exact same string within 2.5 seconds
      if (
        recentScanCooldownRef.current[decodedText] &&
        now - recentScanCooldownRef.current[decodedText] < 2500
      ) {
        return;
      }
      recentScanCooldownRef.current[decodedText] = now;

      // Parse payload (supports URL QR codes, JSON pass payloads, or plain ID strings)
      let parsedPlayerId: string | null = null;
      let parsedName: string | null = null;

      const trimmed = decodedText.trim();
      if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.includes("scanPlayerId=") ||
        trimmed.includes("playerId=")
      ) {
        try {
          const urlObj = new URL(
            trimmed.startsWith("http")
              ? trimmed
              : `https://vesciovector.app${trimmed.startsWith("/") ? "" : "/"}${trimmed}`,
          );
          parsedPlayerId =
            urlObj.searchParams.get("scanPlayerId") ||
            urlObj.searchParams.get("playerId") ||
            urlObj.searchParams.get("id") ||
            null;
        } catch {
          const match = trimmed.match(/(?:scanPlayerId|playerId|id)=([^&#\s]+)/i);
          if (match?.[1]) {
            parsedPlayerId = decodeURIComponent(match[1]);
          }
        }
      }

      if (!parsedPlayerId) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object") {
            parsedPlayerId = parsed.playerId || parsed.id || null;
            parsedName = parsed.name || null;
          }
        } catch {
          // Plain string fallback
          parsedPlayerId = trimmed;
        }
      }

      if (!parsedPlayerId) {
        const errorEvt: ScanEvent = {
          id: `scan-${now}`,
          type: "error",
          title: "Invalid QR Code",
          subtitle: "Scanned code is not a valid Academy Player Pass.",
          timestamp: new Date().toISOString(),
          timeStr,
          rawText: decodedText,
        };
        setLastScanEvent(errorEvt);
        if (soundEnabled) playCheckInFeedback("error");
        return;
      }

      // Look up player across academy
      const matchedPlayer = db.players.find(
        (p) =>
          p.id.toLowerCase() === parsedPlayerId?.toLowerCase() ||
          (parsedName && p.name.toLowerCase() === parsedName.toLowerCase()),
      );

      if (!matchedPlayer) {
        const errorEvt: ScanEvent = {
          id: `scan-${now}`,
          type: "error",
          title: "Player Not Found",
          subtitle: `No academy player found with ID "${parsedPlayerId}".`,
          timestamp: new Date().toISOString(),
          timeStr,
          rawText: decodedText,
        };
        setLastScanEvent(errorEvt);
        if (soundEnabled) playCheckInFeedback("error");
        return;
      }

      // 1. Guardrail: Active Status Check (Inactive / Suspended)
      const isBlockedStatus =
        matchedPlayer.status?.toLowerCase() === "inactive" ||
        matchedPlayer.status?.toLowerCase() === "suspended";

      if (isBlockedStatus) {
        // Do NOT automatically mark the player as Present.
        // Trigger the error buzzer audio tone and haptic feedback pattern.
        playBlockedBuzzerFeedback();

        const statusLabel = (matchedPlayer.status || "INACTIVE").toUpperCase();
        setBlockedPlayerDialog({
          player: matchedPlayer,
          status: statusLabel,
          reason: "Account on hold or inactive registration.",
          timeStr,
        });

        const blockedEvt: ScanEvent = {
          id: `scan-${now}`,
          type: "error",
          title: `⛔ CHECK-IN BLOCKED: ${matchedPlayer.name} is marked [${statusLabel}].`,
          subtitle: "Reason: Account on hold or inactive registration.",
          player: matchedPlayer,
          timestamp: new Date().toISOString(),
          timeStr,
        };
        setLastScanEvent(blockedEvt);
        setRecentScans((prev) => [blockedEvt, ...prev.slice(0, 19)]);
        return;
      }

      // 2. Attendance Soft-Flag Warning (< 60% Attendance in past 30 days)
      const attStats = calculatePlayer30DayAttendance(
        matchedPlayer.id,
        matchedPlayer,
        db.sessions,
        db.attendance,
      );
      const flag = attStats.isLowAttendance ? "low_attendance_warning" : undefined;

      // Resolve target session (active session or player's next scheduled session)
      const nextSession = findPlayerNextSession(matchedPlayer, db.sessions);
      const effectiveSessionId = sessionId || nextSession?.id || "";

      // Check if player is assigned to this session's roster (or if using player's next session)
      const isInRoster =
        roster.length === 0 ||
        roster.some((p) => p.id === matchedPlayer.id) ||
        (!sessionId && Boolean(nextSession));

      // Check attendance state
      const sessionAttendance = effectiveSessionId ? db.attendance[effectiveSessionId] || {} : {};
      const currentStatus = sessionAttendance[matchedPlayer.id];

      if (isInRoster) {
        // 1. Success check-in!
        const isDuplicate = currentStatus === "Present";
        const ts = new Date().toISOString();

        if (effectiveSessionId) {
          await recordAttendance(effectiveSessionId, matchedPlayer.id, "Present", ts, {
            method: "qr",
            flag,
          });
        }
        if (onCheckIn) {
          onCheckIn(matchedPlayer, "Present");
        }

        if (attStats.isLowAttendance) {
          const warnEvt: ScanEvent = {
            id: `scan-${now}`,
            type: "warning",
            title: `⚠️ Low Attendance Warning: ${matchedPlayer.name} (Rate: ${attStats.rate}% over last 30 days).`,
            subtitle: `Marked Present · Flagged for coach review · ${matchedPlayer.teams?.[0] || matchedPlayer.category || "Squad"}`,
            player: matchedPlayer,
            timestamp: ts,
            timeStr,
          };
          setLastScanEvent(warnEvt);
          setRecentScans((prev) => [warnEvt, ...prev.slice(0, 19)]);
          if (soundEnabled) playCheckInFeedback("warning");
          toast.warning(
            `⚠️ Low Attendance Warning: ${matchedPlayer.name} (Rate: ${attStats.rate}% over last 30 days).`,
          );
        } else {
          const successEvt: ScanEvent = {
            id: `scan-${now}`,
            type: isDuplicate ? "duplicate" : "success",
            title: isDuplicate
              ? `${matchedPlayer.name} (Already Checked In)`
              : `${matchedPlayer.name} Checked In!`,
            subtitle: isDuplicate
              ? `Verified present at ${timeStr} · Turnstile pass verified`
              : `Marked Present · ${matchedPlayer.teams?.[0] || matchedPlayer.category || "Squad"}`,
            player: matchedPlayer,
            timestamp: ts,
            timeStr,
          };

          setLastScanEvent(successEvt);
          setRecentScans((prev) => [successEvt, ...prev.slice(0, 19)]);
          if (soundEnabled) playCheckInFeedback("success");
        }

        if (!continuousMode) {
          toast.success(`${matchedPlayer.name} checked in successfully!`);
          stopCamera();
          onClose();
        }
      } else {
        // 2. Warning: Player registered in different squad/branch
        const assignedSquad = matchedPlayer.teams?.[0] || matchedPlayer.category || "General";
        const assignedBranch = matchedPlayer.branch || "Other Branch";

        const warningEvt: ScanEvent = {
          id: `scan-${now}`,
          type: "warning",
          title: `⚠️ Cross-Squad Player: ${matchedPlayer.name}`,
          subtitle: `Player is registered in [${assignedSquad} · ${assignedBranch}], not assigned to this session.`,
          player: matchedPlayer,
          timestamp: new Date().toISOString(),
          timeStr,
        };

        setLastScanEvent(warningEvt);
        setRecentScans((prev) => [warningEvt, ...prev.slice(0, 19)]);
        if (soundEnabled) playCheckInFeedback("warning");
      }

      // Auto-hide banner after 4.5s
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => {
        setLastScanEvent(null);
      }, 4500);
    },
    [
      db.players,
      db.attendance,
      db.sessions,
      sessionId,
      roster,
      soundEnabled,
      continuousMode,
      recordAttendance,
      onCheckIn,
      stopCamera,
      onClose,
    ],
  );

  // Handle image file upload for QR scanning fallback
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        let tempScanner = scannerRef.current;
        if (!tempScanner) {
          tempScanner = new Html5Qrcode("qr-reader-viewport", {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            verbose: false,
          }) as unknown as typeof scannerRef.current;
        }
        const decodedText = await tempScanner!.scanFile(file, true);
        await handleScannedResult(decodedText);
      } catch (fileErr) {
        console.warn("QR file scan failed:", fileErr);
        toast.error(
          "Could not detect a valid player pass QR code in that image. Please try another image or use manual search.",
        );
      } finally {
        e.target.value = "";
      }
    },
    [handleScannedResult],
  );

  // Start the camera
  const startCamera = useCallback(async () => {
    setCameraError(null);
    await stopCamera();

    const element = document.getElementById("qr-reader-viewport");
    if (!element) return;

    // Check mediaDevices support
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setCameraError(
        "Camera streaming is not accessible in this environment. You can switch to Manual Search or upload a pass image.",
      );
      setIsScanning(false);
      return;
    }

    // Check browser permission status if query API is available
    if (typeof navigator.permissions?.query === "function") {
      try {
        const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (perm && perm.state === "denied") {
          setCameraError(
            "Camera permission is currently blocked in your browser settings. You can switch to Manual Search or upload a pass image below.",
          );
          setIsScanning(false);
          return;
        }
      } catch {
        // Permissions query for camera is not supported across all browsers/iframes, proceed with start
      }
    }

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("qr-reader-viewport", {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });

      scannerRef.current = html5QrCode as unknown as typeof scannerRef.current;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          handleScannedResult(decodedText);
        },
        () => {
          // Frame missed (normal operation)
        },
      );

      setIsScanning(true);
    } catch (err: unknown) {
      // Safe cleanup of instance
      try {
        if (scannerRef.current) {
          await Promise.resolve(scannerRef.current.clear()).catch(() => {});
        }
      } catch {
        // Suppress cleanup error
      }
      scannerRef.current = null;
      setIsScanning(false);

      const errString = String(err || "");
      const isPermissionDenied =
        (err instanceof Error &&
          (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) ||
        errString.includes("NotAllowedError") ||
        errString.includes("Permission denied") ||
        errString.includes("Permission");

      const isNotFound =
        (err instanceof Error &&
          (err.name === "NotFoundError" || err.name === "DevicesNotFoundError")) ||
        errString.includes("NotFoundError") ||
        errString.includes("No device");

      if (isPermissionDenied) {
        console.warn("Camera permission was not granted by user or browser policy:", errString);
        setCameraError(
          "Camera access was denied by your browser or device permissions. You can switch to Manual Search or upload a pass image below.",
        );
      } else if (isNotFound) {
        console.warn("No camera device found:", errString);
        setCameraError(
          "No camera hardware found on this device. You can use manual check-in below.",
        );
      } else {
        console.warn("Camera initialization notice:", errString);
        setCameraError(
          err instanceof Error && err.message
            ? err.message
            : "Could not initialize camera stream. Please use manual check-in below.",
        );
      }
    }
  }, [handleScannedResult, stopCamera]);

  // Handle open / close lifecycle
  useEffect(() => {
    if (open && activeTab === "camera") {
      // Small timeout to allow DOM element #qr-reader-viewport to render
      const timer = setTimeout(() => {
        startCamera();
      }, 150);
      return () => {
        clearTimeout(timer);
        stopCamera();
      };
    } else {
      stopCamera();
      return undefined;
    }
  }, [open, activeTab, startCamera, stopCamera]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // Manager Override Action for Inactive/Suspended player
  const handleManagerOverride = async (player: Player, timeStr: string) => {
    const ts = new Date().toISOString();
    const attStats = calculatePlayer30DayAttendance(player.id, player, db.sessions, db.attendance);
    const flag = attStats.isLowAttendance ? "low_attendance_warning" : undefined;

    if (sessionId) {
      await recordAttendance(sessionId, player.id, "Present", ts, {
        method: "qr",
        flag,
      });
    }
    if (onCheckIn) {
      onCheckIn(player, "Present");
    }

    // Event Trigger: Attendance Guardrail alert when an inactive/suspended player check-in is overridden
    if (
      player.status?.toLowerCase() === "inactive" ||
      player.status?.toLowerCase() === "suspended"
    ) {
      dispatchAttendanceGuardrailAlert(tenantId, {
        playerName: player.name,
        playerBranch: player.branch,
        targetTeam: player.teams?.[0] || (player as Player & { team?: string }).team || undefined,
        status: player.status,
        overrideTime: timeStr,
        sessionId: sessionId || undefined,
      }).catch((e) => console.warn("Failed to dispatch attendance guardrail alert:", e));
    }

    if (soundEnabled) playCheckInFeedback("success");

    if (attStats.isLowAttendance) {
      const warnEvt: ScanEvent = {
        id: `scan-${Date.now()}`,
        type: "warning",
        title: `⚠️ Low Attendance Warning: ${player.name} (Rate: ${attStats.rate}% over last 30 days).`,
        subtitle: `Marked Present via Manager Override · Low 30d attendance flagged`,
        player,
        timestamp: ts,
        timeStr,
      };
      setLastScanEvent(warnEvt);
      setRecentScans((prev) => [warnEvt, ...prev.slice(0, 19)]);
      toast.warning(
        `⚠️ Low Attendance Warning: ${player.name} (Rate: ${attStats.rate}% over last 30 days).`,
      );
    } else {
      const successEvt: ScanEvent = {
        id: `scan-${Date.now()}`,
        type: "success",
        title: `${player.name} Checked In! (Manager Override)`,
        subtitle: `Manager attendance override approved at ${timeStr}.`,
        player,
        timestamp: ts,
        timeStr,
      };
      setLastScanEvent(successEvt);
      setRecentScans((prev) => [successEvt, ...prev.slice(0, 19)]);
      toast.success(`${player.name} marked Present via Manager Override`);
    }
  };

  // Manual Check-In Override Action
  const handleManualCheckIn = async (player: Player, status: "Present" | "Absent" | "Excused") => {
    const isBlocked =
      player.status?.toLowerCase() === "inactive" || player.status?.toLowerCase() === "suspended";

    if (isBlocked && status === "Present") {
      playBlockedBuzzerFeedback();
      const statusLabel = (player.status || "INACTIVE").toUpperCase();
      setBlockedPlayerDialog({
        player,
        status: statusLabel,
        reason: "Account on hold or inactive registration.",
        timeStr: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
      return;
    }

    const attStats = calculatePlayer30DayAttendance(player.id, player, db.sessions, db.attendance);
    const flag =
      status === "Present" && attStats.isLowAttendance ? "low_attendance_warning" : undefined;
    const ts = new Date().toISOString();

    if (sessionId) {
      await recordAttendance(sessionId, player.id, status, ts, {
        method: "manual",
        flag,
      });
    }
    if (onCheckIn) {
      onCheckIn(player, status);
    }
    if (soundEnabled) {
      playCheckInFeedback(status === "Present" ? (flag ? "warning" : "success") : "warning");
    }

    if (status === "Present" && attStats.isLowAttendance) {
      toast.warning(
        `⚠️ Low Attendance Warning: ${player.name} (Rate: ${attStats.rate}% over last 30 days).`,
      );
    } else {
      toast.success(`${player.name} marked ${status}`);
    }
  };

  // Filter roster and all players for manual fallback
  const filteredRoster = roster.filter(
    (p) =>
      p.name.toLowerCase().includes(manualQuery.toLowerCase()) ||
      p.parentPhone.includes(manualQuery) ||
      (p.teams && p.teams.some((t) => t.toLowerCase().includes(manualQuery.toLowerCase()))),
  );

  const nonRosterPlayers = manualQuery.trim()
    ? db.players
        .filter((p) => !roster.some((r) => r.id === p.id))
        .filter(
          (p) =>
            p.name.toLowerCase().includes(manualQuery.toLowerCase()) ||
            p.parentPhone.includes(manualQuery) ||
            p.branch.toLowerCase().includes(manualQuery.toLowerCase()),
        )
    : [];

  const sessionAttendance = sessionId ? db.attendance[sessionId] || {} : {};

  return (
    <Modal
      open={open}
      title="Turnstile & QR Pass Scanner"
      meta={
        session ? `${session.title} · ${session.date} · ${session.court}` : "Pitch-side Attendance"
      }
      onClose={() => {
        stopCamera();
        onClose();
      }}
      wide
    >
      <div className="p-4 space-y-4">
        {/* Top Control Bar: Mode Toggle, Audio Toggle, Manual Tab */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-950 p-3 border border-ink-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("camera")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold font-mono transition-colors ${
                activeTab === "camera"
                  ? "bg-court-500 text-ink-950"
                  : "bg-ink-850 text-ink-300 hover:bg-ink-800"
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Camera Scanner</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manual")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold font-mono transition-colors ${
                activeTab === "manual"
                  ? "bg-court-500 text-ink-950"
                  : "bg-ink-850 text-ink-300 hover:bg-ink-800"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Manual Search ({filteredRoster.length})</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold font-mono bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100 transition-colors"
              title="Upload photo or screenshot of a player QR pass"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Pass</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Continuous Mode Toggle */}
            <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-ink-200">
              <input
                type="checkbox"
                checked={continuousMode}
                onChange={(e) => setContinuousMode(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-court-500 focus:ring-court-400"
              />
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-court-400" />
                <span>Continuous Scan</span>
              </span>
            </label>

            {/* Sound Toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              title={soundEnabled ? "Sound Effects Enabled" : "Sound Muted"}
              className="p-1.5 rounded bg-ink-850 hover:bg-ink-800 text-ink-300 hover:text-ink-100 transition-colors"
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-court-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-ink-500" />
              )}
            </button>
          </div>
        </div>

        {/* Inactive / Suspended Guardrail Block Modal / Banner */}
        {blockedPlayerDialog && (
          <div className="animate-in fade-in zoom-in-95 duration-200 rounded-xl p-4 bg-bad/20 border-2 border-bad/80 text-white shadow-2xl space-y-3">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-bad/30 text-bad shrink-0 mt-0.5 border border-bad/50">
                <ShieldAlert className="w-6 h-6 text-bad" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-bad leading-snug">
                  ⛔ CHECK-IN BLOCKED: {blockedPlayerDialog.player.name} is marked [
                  {blockedPlayerDialog.status}]. Reason: {blockedPlayerDialog.reason}
                </div>
                <p className="text-xs text-ink-300 mt-1">
                  Active status guardrail enforced. Account registration is on hold or inactive.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono text-ink-300">
                  <span className="rounded bg-ink-900/90 px-2 py-0.5 border border-ink-700">
                    Squad:{" "}
                    {blockedPlayerDialog.player.teams?.join(", ") ||
                      blockedPlayerDialog.player.category}
                  </span>
                  <span className="rounded bg-ink-900/90 px-2 py-0.5 border border-ink-700">
                    Branch: {blockedPlayerDialog.player.branch}
                  </span>
                  <span className="rounded bg-ink-900/90 px-2 py-0.5 border border-ink-700">
                    Ledger Balance: ${blockedPlayerDialog.player.balance}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-bad/30">
              <div className="flex items-center gap-2">
                <Link
                  to="/players"
                  search={{ playerId: blockedPlayerDialog.player.id } as never}
                  onClick={() => {
                    stopCamera();
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 rounded bg-ink-900/90 hover:bg-ink-800 px-2.5 py-1.5 font-mono text-xs text-court-300 border border-ink-700"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Player Profile</span>
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const p = blockedPlayerDialog.player;
                    setBlockedPlayerDialog(null);
                    toast.error(`Check-in denied: ${p.name} entry rejected.`);
                  }}
                  className="text-xs px-3 py-1.5 border border-ink-700 hover:bg-ink-800 text-ink-200"
                >
                  Dismiss / Deny Entry
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    const p = blockedPlayerDialog.player;
                    const time = blockedPlayerDialog.timeStr;
                    setBlockedPlayerDialog(null);
                    await handleManagerOverride(p, time);
                  }}
                  className="text-xs px-3.5 py-1.5 bg-bad hover:bg-bad/85 text-white font-bold tracking-wide"
                >
                  Manager Override: Mark Present Anyway
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Live Feedback Banner (Green Flash / Amber Warning / Red Error) */}
        {lastScanEvent && (
          <div
            className={`animate-in fade-in slide-in-from-top-2 duration-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-lg border ${
              lastScanEvent.type === "success" || lastScanEvent.type === "duplicate"
                ? "bg-good/20 border-good/50 text-good"
                : lastScanEvent.type === "warning"
                  ? "bg-amber-950/60 border-amber-500/60 text-amber-200"
                  : "bg-bad/20 border-bad/50 text-bad"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 font-mono text-sm font-bold shrink-0">
                {lastScanEvent.type === "success" ? (
                  <CheckCircle2 className="w-6 h-6 text-good" />
                ) : lastScanEvent.type === "warning" ? (
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                ) : (
                  <XCircle className="w-6 h-6 text-bad" />
                )}
              </div>
              <div>
                <div className="font-semibold text-sm leading-tight text-white flex items-center gap-2 flex-wrap">
                  <span>{lastScanEvent.title}</span>
                  <span className="font-mono text-[10px] text-white/70">
                    {lastScanEvent.timeStr}
                  </span>
                </div>
                <div className="text-xs opacity-90 mt-0.5">{lastScanEvent.subtitle}</div>
                {lastScanEvent.player && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {lastScanEvent.player.isScholarship ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                        🎓 Scholarship / Exempt
                      </span>
                    ) : (lastScanEvent.player.balance || 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/25 px-2.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/50">
                        ⚠️ Balance Due: ${lastScanEvent.player.balance}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-good/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-good ring-1 ring-good/40">
                        ✅ Tuition Paid ($0 Balance)
                      </span>
                    )}
                    {(() => {
                      const att30d = calculatePlayer30DayAttendance(
                        lastScanEvent.player.id,
                        lastScanEvent.player,
                        db.sessions,
                        db.attendance,
                      );
                      const mtdPresent = getPlayerMonthlyPresentCount(
                        lastScanEvent.player.id,
                        db.sessions,
                        db.attendance,
                      );
                      const allowedCap = Number(lastScanEvent.player.allowedPracticesPerMonth || 0);
                      const isOverCap =
                        allowedCap > 0 && allowedCap < 999 && mtdPresent > allowedCap;
                      return (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/80 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700">
                            30d Att: {att30d.rate}%
                          </span>
                          {allowedCap > 0 && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold ${
                                isOverCap
                                  ? "bg-bad/25 text-bad ring-1 ring-bad/50"
                                  : "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                              }`}
                            >
                              {isOverCap
                                ? `⚠️ ${mtdPresent}/${allowedCap} Practices Used (Limit Exceeded)`
                                : `${mtdPresent}/${allowedCap >= 999 ? "∞" : allowedCap} Practices Used`}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {lastScanEvent.player && (
                <>
                  <Link
                    to="/players"
                    search={{ playerId: lastScanEvent.player.id } as never}
                    onClick={() => {
                      stopCamera();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-ink-900/90 hover:bg-ink-800 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-court-300 border border-ink-700 transition-colors"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Player Profile ↗</span>
                  </Link>
                  <Link
                    to="/sessions"
                    search={{ scanPlayerId: lastScanEvent.player.id } as never}
                    onClick={() => {
                      stopCamera();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-ink-900/90 hover:bg-ink-800 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-200 border border-ink-700 transition-colors"
                  >
                    <CalendarCheck className="w-3.5 h-3.5 text-court-400" />
                    <span>Next Session ↗</span>
                  </Link>
                </>
              )}

              {/* If warning (cross-squad player), allow coach to override & check in anyway */}
              {lastScanEvent.type === "warning" && lastScanEvent.player && (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (lastScanEvent.player) {
                      handleManualCheckIn(lastScanEvent.player, "Present");
                      setLastScanEvent((prev) =>
                        prev
                          ? {
                              ...prev,
                              type: "success",
                              title: `${prev.player?.name} Added as Guest Present`,
                              subtitle: "Guest attendance override logged in ledger.",
                            }
                          : null,
                      );
                    }
                  }}
                  className="text-xs py-1.5 px-3 shrink-0 bg-amber-500 hover:bg-amber-400 text-ink-950 font-bold"
                >
                  Check In Anyway
                </Button>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: CAMERA SCANNER VIEWPORT */}
        {activeTab === "camera" && (
          <div className="space-y-4">
            <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-black border-2 border-ink-800 shadow-2xl aspect-square flex flex-col items-center justify-center">
              {/* HTML5 QR Code Mount Element */}
              <div id="qr-reader-viewport" className="w-full h-full object-cover" />

              {/* Viewfinder Target Overlay */}
              {isScanning && !cameraError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  {/* Corner Guides */}
                  <div className="relative h-60 w-60 rounded-xl border border-court-400/40">
                    <div className="absolute -top-1 -left-1 h-6 w-6 border-t-4 border-l-4 border-court-400 rounded-tl-md" />
                    <div className="absolute -top-1 -right-1 h-6 w-6 border-t-4 border-r-4 border-court-400 rounded-tr-md" />
                    <div className="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-court-400 rounded-bl-md" />
                    <div className="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-court-400 rounded-br-md" />

                    {/* Animated Scanning Laser Line */}
                    <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-court-500 via-court-300 to-court-500 shadow-[0_0_8px_#34d399] animate-pulse top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              )}

              {/* Camera Error / Permission Notice */}
              {cameraError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-ink-950/95 text-ink-200 space-y-3">
                  <div className="p-3 rounded-full bg-bad/15 text-bad">
                    <CameraOff className="w-8 h-8" />
                  </div>
                  <div className="font-semibold text-sm text-ink-100">Camera Access Blocked</div>
                  <p className="text-xs text-ink-400 max-w-xs">{cameraError}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <Button
                      variant="primary"
                      onClick={() => setActiveTab("manual")}
                      className="text-xs bg-court-500 hover:bg-court-400 text-ink-950 font-bold"
                    >
                      <Search className="w-3.5 h-3.5 mr-1" />
                      Switch to Manual Search
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs bg-ink-850 hover:bg-ink-800 text-ink-200 border border-ink-700 flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Pass Image</span>
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={startCamera}
                      className="text-xs text-ink-400 hover:text-ink-200"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="text-center font-mono text-[11px] text-ink-400">
              Align member QR code inside the frame. Status updates instantaneously to Cloud
              Firestore.
            </div>

            {/* Recent Scans Feed (Turnstile Log) */}
            {recentScans.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-ink-850">
                <div className="flex items-center justify-between text-xs font-mono text-ink-400">
                  <span className="uppercase tracking-wider">Session Turnstile Log</span>
                  <span>{recentScans.length} verified scans</span>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {recentScans.map((scan) => (
                    <div
                      key={scan.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-ink-950 border border-ink-800 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            scan.type === "success" || scan.type === "duplicate"
                              ? "bg-good"
                              : scan.type === "warning"
                                ? "bg-amber-400"
                                : "bg-bad"
                          }`}
                        />
                        <span className="font-semibold text-ink-100 truncate">
                          {scan.player?.name || scan.title}
                        </span>
                        {scan.player?.teams?.[0] && (
                          <span className="font-mono text-[10px] text-court-400 shrink-0">
                            {scan.player.teams[0]}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {scan.player && (
                          <Link
                            to="/players"
                            search={{ playerId: scan.player.id } as never}
                            onClick={() => {
                              stopCamera();
                              onClose();
                            }}
                            className="font-mono text-[10px] text-court-400 hover:underline px-1.5 py-0.5 rounded bg-court-500/10"
                          >
                            Profile →
                          </Link>
                        )}
                        <span className="font-mono text-[10px] text-ink-400">{scan.timeStr}</span>
                        <span className="font-mono text-[10px] font-semibold text-good">
                          ✓ PRESENT
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MANUAL SEARCH FALLBACK (In case of phone battery died / camera unavailable) */}
        {activeTab === "manual" && (
          <div className="space-y-4">
            <div className="relative">
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="Search player by name, phone, squad, branch..."
                className="w-full rounded-md bg-ink-900 border border-ink-700 px-3.5 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-court-400 focus:outline-none"
              />
              {manualQuery && (
                <button
                  type="button"
                  onClick={() => setManualQuery("")}
                  className="absolute right-3 top-2.5 text-xs text-ink-400 hover:text-ink-200"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-400">
                Session Roster ({filteredRoster.length})
              </div>

              {filteredRoster.length === 0 ? (
                <div className="p-4 rounded-lg bg-ink-950 border border-ink-800 text-center text-xs text-ink-400">
                  No roster players match "{manualQuery}".
                </div>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {filteredRoster.map((player) => {
                    const status = sessionAttendance[player.id] || "Absent";
                    return (
                      <div
                        key={player.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                          status === "Present"
                            ? "bg-good/10 border-good/30 text-ink-100"
                            : status === "Excused"
                              ? "bg-amber-950/20 border-amber-800/30 text-ink-200"
                              : "bg-ink-950 border-ink-800 text-ink-300"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-court-500/15 text-court-400 font-mono font-bold flex items-center justify-center shrink-0">
                            {player.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-ink-100 truncate">
                                {player.name}
                              </span>
                              <Link
                                to="/players"
                                search={{ playerId: player.id } as never}
                                onClick={() => {
                                  stopCamera();
                                  onClose();
                                }}
                                className="font-mono text-[10px] text-court-400 hover:underline"
                              >
                                Profile →
                              </Link>
                              {(player.status?.toLowerCase() === "inactive" ||
                                player.status?.toLowerCase() === "suspended") && (
                                <span className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bad ring-1 ring-bad/30">
                                  {player.status}
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-ink-400 truncate">
                              {player.category} · {player.teams?.join(", ") || "No squad"}
                            </div>
                          </div>
                        </div>

                        {/* Hybrid Manual Override Buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleManualCheckIn(player, "Absent")}
                            className={`rounded px-2 py-1 font-mono text-[10px] font-semibold ring-1 transition-colors ${
                              status === "Absent"
                                ? "bg-bad text-white ring-bad"
                                : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                            }`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleManualCheckIn(player, "Excused")}
                            className={`rounded px-2 py-1 font-mono text-[10px] font-semibold ring-1 transition-colors ${
                              status === "Excused"
                                ? "bg-warn text-ink-950 ring-warn"
                                : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                            }`}
                          >
                            E
                          </button>
                          <button
                            type="button"
                            onClick={() => handleManualCheckIn(player, "Present")}
                            className={`rounded px-2.5 py-1 font-mono text-[10px] font-bold ring-1 transition-colors ${
                              status === "Present"
                                ? "bg-good text-ink-950 ring-good"
                                : "text-court-400 ring-court-500/40 hover:bg-court-500/15"
                            }`}
                          >
                            {status === "Present" ? "✓ PRESENT" : "P"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cross-squad or non-rostered academy players matching search */}
              {nonRosterPlayers.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-ink-850">
                  <div className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Other Academy Players Matching Search ({nonRosterPlayers.length})</span>
                  </div>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {nonRosterPlayers.map((player) => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-amber-950/20 border border-amber-800/30 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-ink-200">{player.name}</span>
                            {(player.status?.toLowerCase() === "inactive" ||
                              player.status?.toLowerCase() === "suspended") && (
                              <span className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bad ring-1 ring-bad/30">
                                {player.status}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-ink-400">
                            {player.branch} · {player.teams?.join(", ") || player.category}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => handleManualCheckIn(player, "Present")}
                          className="text-[10px] font-mono py-1 px-2 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                        >
                          Check In as Guest
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
