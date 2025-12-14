export type DevUser = {
  name: string
  email: string
  avatarUrl?: string
}

const STORAGE_KEY = "ignis.devUser"

export const DEFAULT_DEV_USER: DevUser = {
  name: "Dev User",
  email: "dev@ignis.local",
  avatarUrl: "",
}

export function getDevUser(): DevUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_DEV_USER
    const parsed = JSON.parse(raw) as Partial<DevUser>
    if (!parsed || typeof parsed !== "object") return DEFAULT_DEV_USER
    return {
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : DEFAULT_DEV_USER.name,
      email:
        typeof parsed.email === "string" && parsed.email ? parsed.email : DEFAULT_DEV_USER.email,
      avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : DEFAULT_DEV_USER.avatarUrl,
    }
  } catch {
    return DEFAULT_DEV_USER
  }
}

export function setDevUser(user: DevUser = DEFAULT_DEV_USER) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  } catch {
    // ignore storage failures
  }
}


