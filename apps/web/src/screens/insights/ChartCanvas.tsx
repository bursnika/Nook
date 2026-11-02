import { Chart, type ChartConfiguration } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

// chart.js can't read var(--x)
export function palette() {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: get('--ink', '#2b1e33'),
    pink: get('--pink-700', '#b8326f'),
    pinkSoft: get('--pink-300', '#f4a3c8'),
    lavender: get('--lav-500', '#9d7bc9'),
    lavenderSoft: get('--lav-200', '#dccbf0'),
    blue: get('--blue-500', '#5b8fd6'),
    gray: get('--gray-300', '#bdb8c6'),
    grid: get('--lav-100', '#eee6f8'),
    text: get('--gray-500', '#6f6979'),
    body: get('--font-body', 'Nunito, system-ui, sans-serif').split(',')[0]!.replace(/['"]/g, ''),
  };
}

export function ChartCanvas({
  config,
  label,
  height = 220,
}: {
  config: ChartConfiguration;
  label: string;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(config);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const chart = new Chart(element, JSON.parse(key) as ChartConfiguration);
    return () => chart.destroy();
  }, [key]);

  return (
    <div className="chart" style={{ height }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
