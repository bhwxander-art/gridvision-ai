import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMW(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} MW`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
