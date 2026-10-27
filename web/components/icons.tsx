import {
  CalendarDays, CloudRain, Layers, Megaphone, SunMedium, Thermometer, type LucideIcon,
} from "lucide-react";

// Layer-group icons, picked by the profile's group `icon` (or its id).
const ICONS: Record<string, LucideIcon> = {
  advisory: Megaphone,
  rainfall: CloudRain,
  rain: CloudRain,
  season: CalendarDays,
  onset: CalendarDays,
  drought: SunMedium,
  heat: Thermometer,
  temperature: Thermometer,
  layers: Layers,
};

export function GroupIcon({ name, size = 18 }: { name?: string | null; size?: number }) {
  const I = (name && ICONS[name]) || Layers;
  return <I size={size} aria-hidden />;
}
