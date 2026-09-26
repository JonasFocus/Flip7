import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function SnowflakeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      <path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5M4.2 10.6l3.4-.9-.9-3.4M19.8 13.4l-3.4.9.9 3.4M4.2 13.4l3.4.9-.9 3.4M19.8 10.6l-3.4-.9.9-3.4" />
    </svg>
  );
}

export function FlipThreeIcon(props: IconProps) {
  const cut = { fill: "var(--color-surface)" };
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4" width="10" height="14" rx="2.2" transform="rotate(-12 7.5 11)" style={cut} />
      <rect x="7" y="5" width="10" height="14" rx="2.2" style={cut} />
      <rect x="11.5" y="6" width="10" height="14" rx="2.2" transform="rotate(12 16.5 13)" fill="currentColor" />
    </svg>
  );
}

export function SecondChanceIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        d="M12 20.5s-8.5-5-8.5-11A4.75 4.75 0 0 1 12 6.6a4.75 4.75 0 0 1 8.5 2.9c0 6-8.5 11-8.5 11Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M12 10v6M9 13h6" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TimesTwoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m3.5 8.5 7 7m0-7-7 7" />
      <path d="M14 9.5a3 3 0 0 1 6 .25c0 2.25-6 4.25-6 6.75h6" />
    </svg>
  );
}

export function BotIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4.5M9 13v1M15 13v1" />
    </svg>
  );
}
