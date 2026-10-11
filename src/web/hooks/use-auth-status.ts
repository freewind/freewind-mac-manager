import type { AuthStatus } from "@shared/client-api"
import { ensureCsrf, fetchAuthStatus } from "@shared/client-api"
import { describeError } from "@shared/format"
import { useSyncExternalStore } from "react"

type AuthState = {
  status: AuthStatus | null
  error: string | null
}

let state: AuthState = { status: null, error: null }
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

const setState = (next: AuthState) => {
  state = next
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state
const serverState: AuthState = { status: null, error: null }
const getServerSnapshot = () => serverState

export const useAuthStatus = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

export const refreshAuthStatus = async (showError: boolean): Promise<void> => {
  try {
    await ensureCsrf()
    setState({ status: await fetchAuthStatus(), error: null })
  } catch (error) {
    if (showError) setState({ ...state, error: describeError(error) })
  }
}

export const markUnauthenticated = () => {
  if (state.status) {
    setState({
      error: null,
      status: { ...state.status, authenticated: false },
    })
  }
}

export const markAuthenticated = () => {
  if (state.status) {
    setState({
      error: null,
      status: { ...state.status, authenticated: true },
    })
  }
}
