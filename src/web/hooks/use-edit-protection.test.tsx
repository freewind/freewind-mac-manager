// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import {
  hasProtectedEdits,
  publishDraftProtection,
  useEditProtection,
} from "./use-edit-protection"

afterEach(() => {
  cleanup()
  publishDraftProtection("test", false)
})
it("keeps a draft protected after its editing component unmounts", () => {
  publishDraftProtection("test", true)
  const hook = renderHook(() => useEditProtection(true))
  hook.unmount()
  expect(hasProtectedEdits()).toBe(true)
  publishDraftProtection("test", false)
  expect(hasProtectedEdits()).toBe(false)
})

it("protects editing scopes and removes them on close and unmount", () => {
  const hook = renderHook(({ active }) => useEditProtection(active), {
    initialProps: { active: true },
  })
  expect(hasProtectedEdits()).toBe(true)
  hook.rerender({ active: false })
  expect(hasProtectedEdits()).toBe(false)
  hook.rerender({ active: true })
  hook.unmount()
  expect(hasProtectedEdits()).toBe(false)
})
