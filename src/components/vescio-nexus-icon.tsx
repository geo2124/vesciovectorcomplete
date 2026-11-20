import type { SVGProps } from "react";

export function VescioNexusIcon({ className = "w-7 h-4", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* Left teal infinity loop (deep teal in Light Mode, signature bright teal in Dark Mode) */}
      <path
        d="M 29.24 12.52 A 12.5 12.5 0 1 0 29.24 23.48"
        className="stroke-[#0F766E] dark:stroke-[#1DB8AC]"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* Right teal infinity loop */}
      <path
        d="M 34.76 12.52 A 12.5 12.5 0 1 1 34.76 23.48"
        className="stroke-[#0F766E] dark:stroke-[#1DB8AC]"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* Crisp center nexus dot */}
      <circle cx="32" cy="18" r="2.85" className="fill-[#042F2E] dark:fill-white" />
    </svg>
  );
}
