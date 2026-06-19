import { ImageResponse } from "next/og";

/**
 * Favicon — the JOYCO square mark in brand blue on the dark app background,
 * generated via the App Router `icon` convention (replaces the default
 * Next.js favicon.ico). Static metadata so it's emitted at build time.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 128 128"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M112.937 86.4519L86.5654 113.033H68.2617V14.8552H112.937V86.4519Z"
            fill="#3056ff"
          />
          <rect x="15" y="14.8552" width="46.8145" height="67.1709" fill="#3056ff" />
          <rect x="15" y="88.4734" width="46.8145" height="24.5596" fill="#3056ff" />
          <rect x="15" y="21.4553" width="46.6105" height="9.8527" fill="#3056ff" />
          <circle cx="109.132" cy="110.276" r="3.86842" fill="#3056ff" />
        </svg>
      </div>
    ),
    size,
  );
}
