import type { ReactNode, SVGProps } from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function make(path: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg {...base} {...props}>
        {path}
      </svg>
    );
  };
}

export const IconHome = make(<><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></>);
export const IconPlug = make(<><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0V8z" /><path d="M12 17v4" /></>);
export const IconBolt = make(<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />);
export const IconTag = make(<><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="8.5" r="1.2" /></>);
export const IconSend = make(<><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4 18-7z" /></>);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconArrow = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconAlert = make(<><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4M12 17.5v.01" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></>);
export const IconLock = make(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconStar = make(<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8L12 3.5z" />);
export const IconEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
