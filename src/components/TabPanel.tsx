import type { ReactNode } from "react";

type TabPanelProps = {
  active: boolean;
  mounted: boolean;
  children: ReactNode;
};

/** Keeps children mounted after first visit so tab state survives navigation. */
export default function TabPanel({ active, mounted, children }: TabPanelProps) {
  if (!mounted) return null;
  return (
    <div className="tab-panel" hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}
