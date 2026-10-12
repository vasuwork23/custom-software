import { create } from 'zustand'

interface UiState {
  /** Header and sidebar hidden; only the page content shows. */
  fullScreen: boolean
  enterFullScreen: () => void
  exitFullScreen: () => void
}

// True only while the browser itself is in full screen because we asked for it
let browserFull = false

export const isBrowserFullScreen = () => browserFull

export const useUiStore = create<UiState>((set) => ({
  fullScreen: false,
  enterFullScreen: () => {
    set({ fullScreen: true })
    // Hiding the header and sidebar works everywhere; real browser full screen
    // (no tabs or address bar) is a bonus where it's allowed.
    document.documentElement
      .requestFullscreen?.()
      .then(() => {
        browserFull = true
      })
      .catch(() => undefined)
  },
  exitFullScreen: () => {
    set({ fullScreen: false })
    if (browserFull && document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    browserFull = false
  },
}))
