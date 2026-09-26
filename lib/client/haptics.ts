function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // Chrome logs an error for vibrate before the first tap on the page.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers throw without a user gesture; haptics are best-effort
  }
}

export const tap = () => vibrate(10);
export const success = () => vibrate([20, 40, 30]);
export const fail = () => vibrate([60, 30, 60]);
