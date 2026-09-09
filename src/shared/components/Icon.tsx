export type IconName =
    | "timeline"
    | "inventory"
    | "chart"
    | "settings"
    | "search"
    | "filter"
    | "plus"
    | "chevron"
    | "calendar"
    | "more"
    | "close"
    | "undo";

interface IconProps {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  timeline: <path d="M4 7h16M7 4v6m10-6v6M5 12h5m3 0h6M5 17h9m3 0h2" />,
  inventory: <path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10" />,
  chart: <path d="M5 20V10m7 10V4m7 16v-7" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.75v2.1m0 14.3v2.1M2.75 12h2.1m14.3 0h2.1M5.46 5.46l1.49 1.49m10.1 10.1 1.49 1.49M18.54 5.46l-1.49 1.49m-10.1 10.1-1.49 1.49M12 4.85a7.15 7.15 0 1 1 0 14.3 7.15 7.15 0 0 1 0-14.3Z" />
    </>
  ),
  search: <path d="m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />,
  filter: <path d="M4 6h16M7 12h10m-7 6h4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  calendar: <path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 9h18" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  undo: <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" />
};

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
