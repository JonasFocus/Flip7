const ID_KEY = "flip7:clientId";
const NAME_KEY = "flip7:name";
const LAST_ROOM_KEY = "flip7:lastRoom";

let memoryId: string | null = null;

function newClientId(): string {
  // getRandomValues is available on HTTP LAN origins, where randomUUID is not.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getClientId(): string {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved) return saved;
    const id = memoryId ??= newClientId();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    // ponytail: storage blocked (private mode) → id is stable for this page load only
    memoryId ??= newClientId();
    return memoryId;
  }
}

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // storage unavailable; name just isn't remembered
  }
}

// The table this device last joined, so home can offer a way back after an accidental back/swipe.
export function getLastRoom(): string {
  try {
    return localStorage.getItem(LAST_ROOM_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLastRoom(code: string): void {
  try {
    localStorage.setItem(LAST_ROOM_KEY, code);
  } catch {
    // storage unavailable; no way-back card on home
  }
}

export function clearLastRoom(code?: string): void {
  try {
    if (code === undefined || localStorage.getItem(LAST_ROOM_KEY) === code) localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // storage unavailable
  }
}
