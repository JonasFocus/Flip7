const ID_KEY = "flip7:clientId";
const NAME_KEY = "flip7:name";

let memoryId: string | null = null;

export function getClientId(): string {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    // ponytail: storage blocked (private mode) → id is stable for this page load only
    memoryId ??= crypto.randomUUID();
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
