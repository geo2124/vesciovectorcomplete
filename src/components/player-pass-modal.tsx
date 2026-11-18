import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { Modal, Button, Chip } from "@/components/kit";
import type { Player } from "@/lib/mock-data";
import { useDB, findPlayerNextSession } from "@/lib/data-store";
import { QrCode, Printer, ShieldCheck, Download, Loader2, CalendarCheck, User } from "lucide-react";
import { toast } from "sonner";

interface PlayerPassModalProps {
  player: Player | null;
  open: boolean;
  onClose: () => void;
}

export function PlayerPassModal({ player, open, onClose }: PlayerPassModalProps) {
  const { db } = useDB();
  const navigate = useNavigate();
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  if (!player) return null;

  const nextSession = findPlayerNextSession(player, db.sessions);
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://vesciovector.app";
  const playerProfileUrl = `${origin}/players?playerId=${encodeURIComponent(player.id)}`;
  const passPayload = `${origin}/sessions?scanPlayerId=${encodeURIComponent(player.id)}${
    nextSession ? `&sessionId=${encodeURIComponent(nextSession.id)}` : ""
  }&profileUrl=${encodeURIComponent(playerProfileUrl)}`;

  const handlePrint = () => {
    if (!cardRef.current) {
      window.print();
      return;
    }

    // Create an isolated printable frame to guarantee flawless pass-only printing
    const printWindow = window.open("", "_blank", "width=600,height=750");
    if (!printWindow) {
      window.print();
      return;
    }

    const cardHtml = cardRef.current.outerHTML;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Member Pass - ${player.name}</title>
          <meta charset="utf-8" />
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
              background-color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            @page {
              size: auto;
              margin: 15mm;
            }
            .print-card-wrapper {
              width: 380px;
              max-width: 100%;
              margin: 0 auto;
            }
          </style>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body>
          <div class="print-card-wrapper">
            ${cardHtml}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
                window.close();
              }, 350);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadPdf = async () => {
    setIsGeneratingPdf(true);
    const toastId = toast.loading("Generating high-resolution pass PDF...");

    try {
      // 1. Extract QR code data URL from off-screen canvas or fallback
      let qrDataUrl = "";
      try {
        const qrCanvas = document.getElementById(
          `member-pass-qr-canvas-${player.id}`,
        ) as HTMLCanvasElement | null;
        if (qrCanvas) {
          qrDataUrl = qrCanvas.toDataURL("image/png");
        }
      } catch (err) {
        console.warn("Could not extract from QR canvas:", err);
      }

      // Fallback: extract from visible SVG if canvas extraction was empty
      if (!qrDataUrl || qrDataUrl === "data:,") {
        try {
          const svgEl = cardRef.current?.querySelector("svg");
          if (svgEl) {
            const svgData = new XMLSerializer().serializeToString(svgEl);
            const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
            const svgUrl = URL.createObjectURL(svgBlob);
            const fallbackImg = new Image();
            await new Promise<void>((resolve) => {
              fallbackImg.onload = () => resolve();
              fallbackImg.onerror = () => resolve();
              fallbackImg.src = svgUrl;
            });
            const c = document.createElement("canvas");
            c.width = 256;
            c.height = 256;
            const cCtx = c.getContext("2d");
            if (cCtx) {
              cCtx.fillStyle = "#ffffff";
              cCtx.fillRect(0, 0, 256, 256);
              cCtx.drawImage(fallbackImg, 0, 0, 256, 256);
              qrDataUrl = c.toDataURL("image/png");
            }
            URL.revokeObjectURL(svgUrl);
          }
        } catch (svgErr) {
          console.warn("SVG fallback also failed:", svgErr);
        }
      }

      // 2. Build crisp A6 portrait card (105mm x 148mm)
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [105, 148],
      });

      const pageWidth = 105;
      const pageHeight = 148;

      // Dark background for entire document
      pdf.setFillColor(10, 14, 23);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");

      // Pass card container
      const cardMargin = 8;
      const cardW = pageWidth - cardMargin * 2;
      const cardH = pageHeight - cardMargin * 2;

      pdf.setFillColor(15, 23, 42);
      pdf.setDrawColor(30, 41, 59);
      pdf.roundedRect(cardMargin, cardMargin, cardW, cardH, 4, 4, "FD");

      // Top accent bar
      pdf.setFillColor(20, 184, 166);
      pdf.rect(cardMargin + 4, cardMargin, cardW - 8, 1.5, "F");

      // Academy name & subtitle
      const academyName = (db.academy?.name || "VESCIO VECTOR").toUpperCase();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(255, 255, 255);
      pdf.text(academyName, cardMargin + 6, cardMargin + 10);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);
      pdf.setTextColor(45, 212, 191);
      pdf.text("MEMBER DIGITAL PASS", cardMargin + 6, cardMargin + 14);

      // Status badge pill
      const statusText = (player.status || "ACTIVE").toUpperCase();
      const statusW = 20;
      const statusH = 5.5;
      const statusX = cardMargin + cardW - statusW - 6;
      const statusY = cardMargin + 7;

      if (statusText === "ACTIVE") {
        pdf.setFillColor(16, 185, 129);
      } else {
        pdf.setFillColor(245, 158, 11);
      }
      pdf.roundedRect(statusX, statusY, statusW, statusH, 2.5, 2.5, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6);
      pdf.setTextColor(15, 23, 42);
      pdf.text(statusText, statusX + statusW / 2, statusY + 3.8, { align: "center" });

      // Divider line
      pdf.setDrawColor(51, 65, 85);
      pdf.line(cardMargin + 6, cardMargin + 18, cardMargin + cardW - 6, cardMargin + 18);

      // Player initials circle
      const avatarX = cardMargin + 8;
      const avatarY = cardMargin + 24;
      const avatarSize = 18;

      pdf.setFillColor(19, 78, 74);
      pdf.setDrawColor(45, 212, 191);
      pdf.circle(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, "FD");
      const initials = player.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(255, 255, 255);
      pdf.text(initials, avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 3.5, {
        align: "center",
      });

      // Player details text
      const detailsX = avatarX + avatarSize + 6;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(255, 255, 255);
      const displayName = player.name.length > 22 ? player.name.slice(0, 20) + "…" : player.name;
      pdf.text(displayName, detailsX, avatarY + 5);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(45, 212, 191);
      const squadName = player.teams?.[0] || player.category || "Academy Squad";
      pdf.text(`Squad: ${squadName}`, detailsX, avatarY + 10);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`Branch: ${player.branch || "Headquarters"}`, detailsX, avatarY + 15);

      // QR Code Container Box (white card)
      const qrBoxW = 54;
      const qrBoxH = 62;
      const qrBoxX = (pageWidth - qrBoxW) / 2;
      const qrBoxY = avatarY + avatarSize + 8;

      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(qrBoxX, qrBoxY, qrBoxW, qrBoxH, 3, 3, "F");

      if (qrDataUrl && qrDataUrl.startsWith("data:image")) {
        const qrSize = 44;
        const qrImgX = (pageWidth - qrSize) / 2;
        const qrImgY = qrBoxY + 5;
        try {
          pdf.addImage(qrDataUrl, "PNG", qrImgX, qrImgY, qrSize, qrSize);
        } catch (qrErr) {
          console.warn("Could not embed QR image to PDF:", qrErr);
        }
      }

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(5.5);
      pdf.setTextColor(15, 23, 42);
      pdf.text("TURNSTILE READY · SCAN AT PITCH", pageWidth / 2, qrBoxY + qrBoxH - 4.5, {
        align: "center",
      });

      // Footer metadata
      const footerY = qrBoxY + qrBoxH + 9;
      pdf.setDrawColor(51, 65, 85);
      pdf.line(cardMargin + 6, footerY, cardMargin + cardW - 6, footerY);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`DOB: ${player.dob || "—"}`, cardMargin + 6, footerY + 6);
      pdf.text(`Pass ID: ${player.id}`, cardMargin + cardW - 6, footerY + 6, {
        align: "right",
      });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `ISSUED: ${new Date().toISOString().slice(0, 10)} · OFFICIAL VERIFIED CREDENTIAL`,
        pageWidth / 2,
        footerY + 12,
        { align: "center" },
      );

      const fileName = `Pass_${player.name.replace(/\s+/g, "_")}_${player.id}.pdf`;
      pdf.save(fileName);

      toast.success("Player pass PDF downloaded successfully!", { id: toastId });
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Failed to generate PDF pass. Please try again.", { id: toastId });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Member Digital Pass"
      meta={`Official Academy Check-In Credential · ID: ${player.id}`}
      onClose={onClose}
    >
      <div className="p-4 flex flex-col items-center space-y-4">
        {/* Off-screen high-res canvas for crystal clear QR export */}
        <div className="fixed -left-[9999px] -top-[9999px] pointer-events-none opacity-0">
          <QRCodeCanvas
            id={`member-pass-qr-canvas-${player.id}`}
            value={passPayload}
            size={512}
            level="H"
            includeMargin={true}
          />
        </div>

        {/* Physical / Digital Membership Pass Card Container */}
        <div
          ref={cardRef}
          className="relative w-full max-w-sm rounded-2xl bg-gradient-to-b from-ink-900 via-ink-900 to-ink-950 p-5 text-ink-100 shadow-2xl ring-1 ring-court-500/30 overflow-hidden"
        >
          {/* Card Accent Glow & Header watermark */}
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-court-500/10 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-court-400/10 blur-xl pointer-events-none" />

          {/* Top Bar: Academy Brand & Member Chip */}
          <div className="flex items-center justify-between pb-3 border-b border-ink-800">
            <div className="flex items-center gap-2">
              <img
                src={db.academy?.logo || "/vescio-vector-logo.png"}
                alt={db.academy?.name || "Vescio Vector"}
                className="h-7 w-7 object-contain rounded"
                crossOrigin="anonymous"
                onError={(e) => {
                  e.currentTarget.src = "/vescio-vector-logo.png";
                }}
              />
              <div>
                <div className="font-display text-xs font-bold tracking-tight text-ink-100">
                  {db.academy?.name || "VESCIO VECTOR"}
                </div>
                <div className="font-mono text-[9px] tracking-widest text-court-400 uppercase">
                  MEMBER DIGITAL PASS
                </div>
              </div>
            </div>

            <Chip tone={player.status === "Active" ? "good" : "warn"}>
              {String(player.status || "Active").toUpperCase()}
            </Chip>
          </div>

          {/* Middle Row: Initials Badge + Player Details */}
          <div className="mt-4 flex items-center gap-3.5">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-court-500/15 font-mono text-lg font-bold text-court-400 ring-2 ring-court-400/30 shrink-0">
              {player.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <div className="font-display text-base font-bold tracking-tight text-ink-50 truncate">
                {player.name}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-court-300 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-court-400 shrink-0" />
                <span className="truncate">
                  {player.teams?.[0] || player.category || "Academy"}
                </span>
              </div>
              <div className="font-mono text-[10px] text-ink-400 mt-0.5 truncate">
                Branch: <span className="text-ink-200">{player.branch || "Headquarters"}</span>
              </div>
            </div>
          </div>

          {/* QR Code Container */}
          <div className="mt-5 flex flex-col items-center justify-center rounded-xl bg-white p-3.5 shadow-inner">
            <QRCodeSVG
              value={passPayload}
              size={176}
              level="H"
              includeMargin={false}
              fgColor="#090d16"
              bgColor="#ffffff"
            />
            <div className="mt-2 flex items-center gap-1 font-mono text-[10px] font-semibold text-ink-800">
              <QrCode className="w-3 h-3 text-court-600" />
              <span>NEXT SESSION ATTENDANCE &amp; PROFILE QR</span>
            </div>
          </div>

          {/* Pass Footer Metadata */}
          <div className="mt-3.5 space-y-1.5 text-[10px] font-mono text-ink-400 border-t border-ink-850 pt-2.5">
            <div className="flex items-center justify-between">
              <div>
                DOB: <span className="text-ink-200">{player.dob || "—"}</span>
              </div>
              <div>
                ID: <span className="text-court-400 font-semibold">{player.id}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[9px] text-ink-400 pt-1 border-t border-ink-850/60">
              <span className="truncate max-w-[62%]">
                Next:{" "}
                <strong className="text-court-300">
                  {nextSession
                    ? `${nextSession.title} (${nextSession.date})`
                    : "Upcoming Session Attendance"}
                </strong>
              </span>
              <span className="text-emerald-400 font-semibold">Profile Linked ✓</span>
            </div>
          </div>
        </div>

        {/* Next Session & Profile Quick Actions */}
        <div className="w-full max-w-sm rounded-xl bg-ink-900/90 border border-ink-800 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs font-mono">
            <span className="text-ink-400 uppercase text-[10px] shrink-0">
              Next Session Attendance:
            </span>
            {nextSession ? (
              <span className="text-court-300 font-semibold truncate text-right">
                {nextSession.title} ({nextSession.date} · {nextSession.time})
              </span>
            ) : (
              <span className="text-ink-500 text-right">Next scheduled session</span>
            )}
          </div>
          <div className="rounded-lg bg-ink-950/90 px-2.5 py-1.5 border border-ink-850 font-mono text-[10px] text-ink-400 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-500 uppercase">Attendance URL:</span>
              <span className="text-court-300 truncate" title={passPayload}>
                /sessions?scanPlayerId={player.id}
                {nextSession ? `&sessionId=${nextSession.id}` : ""}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-500 uppercase">Profile Link:</span>
              <a
                href={playerProfileUrl}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  navigate({
                    to: "/players",
                    search: { playerId: player.id } as never,
                  });
                }}
                className="text-emerald-400 hover:underline truncate"
                title={playerProfileUrl}
              >
                /players?playerId={player.id}
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate({
                  to: "/sessions",
                  search: {
                    scanPlayerId: player.id,
                    ...(nextSession ? { sessionId: nextSession.id } : {}),
                    profileUrl: playerProfileUrl,
                  } as never,
                });
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-court-500/15 hover:bg-court-500/25 text-court-300 border border-court-500/30 px-2.5 py-2 font-mono text-[11px] font-semibold transition-colors"
            >
              <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Next Session Attendance</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate({
                  to: "/players",
                  search: { playerId: player.id } as never,
                });
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-ink-850 hover:bg-ink-800 text-ink-200 border border-ink-700 px-2.5 py-2 font-mono text-[11px] font-semibold transition-colors"
            >
              <User className="w-3.5 h-3.5 shrink-0 text-court-400" />
              <span>Player Profile</span>
            </button>
          </div>
        </div>

        {/* Action Controls: Download PDF and Print Pass */}
        <div className="flex items-center justify-center gap-2 pt-1 w-full max-w-sm">
          <Button
            variant="primary"
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            className="flex-1 text-xs flex items-center justify-center gap-1.5 bg-court-500 hover:bg-court-400 text-ink-950 font-bold shadow-sm"
          >
            {isGeneratingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isGeneratingPdf ? "Generating..." : "Download PDF"}</span>
          </Button>

          <Button
            variant="ghost"
            onClick={handlePrint}
            className="flex-1 text-xs flex items-center justify-center gap-1.5 bg-ink-850 hover:bg-ink-800 text-court-300 border border-ink-700"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Pass</span>
          </Button>
        </div>

        {/* Security / Verification Instructions */}
        <p className="text-[11px] text-center text-ink-400 max-w-xs leading-relaxed">
          Scanning this QR code opens the player&apos;s next session attendance check-in and
          provides a direct link to their player profile.
        </p>
      </div>
    </Modal>
  );
}
