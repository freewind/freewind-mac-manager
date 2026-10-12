// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GroupsTab } from "./GroupsTab"

const { fetchGroups, fetchModels, addGroup, replaceGroup, deleteGroup } =
  vi.hoisted(() => ({
    fetchGroups: vi.fn(),
    fetchModels: vi.fn(),
    addGroup: vi.fn(),
    replaceGroup: vi.fn(),
    deleteGroup: vi.fn(),
  }))

vi.mock("@shared/client-api", () => ({
  fetchPiModelGroups: fetchGroups,
  fetchPiModels: fetchModels,
  addPiModelGroup: addGroup,
  replacePiModelGroup: replaceGroup,
  deletePiModelGroup: deleteGroup,
}))

const groupsResponse = {
  signature: "b".repeat(64),
  updatedAt: 1,
  groups: [
    {
      id: "g-mimo",
      group: {
        name: "g-mimo",
        contextWindow: 1048576,
        maxTokens: 131072,
        members: [
          { provider: "alpha", modelId: "model-a" },
          { provider: "beta", modelId: "model-b" },
        ],
      },
    },
  ],
}

const modelsResponse = {
  signature: "a".repeat(64),
  updatedAt: 1,
  providers: [
    {
      id: "alpha",
      hasApiKey: true,
      modelCount: 1,
      provider: {
        name: "Alpha",
        baseUrl: "https://example.test/v1",
        api: "openai-completions",
        models: [{ id: "model-a", contextWindow: 1000, maxTokens: 100 }],
      },
    },
    {
      id: "beta",
      hasApiKey: true,
      modelCount: 1,
      provider: {
        name: "Beta",
        baseUrl: "https://example.test/v1",
        api: "openai-completions",
        models: [{ id: "model-b", contextWindow: 1000, maxTokens: 100 }],
      },
    },
  ],
}

const renderTab = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GroupsTab />
    </QueryClientProvider>
  )
}

/** 打开成员行的下拉并点选一项；与 PiPage 的 Combobox 交互方式一致。 */
const pickOption = async (
  fieldName: RegExp,
  optionName: string
): Promise<void> => {
  const input = screen.getByRole("combobox", { name: fieldName })
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.click(
    await within(document.body).findByRole("option", { name: optionName })
  )
}

beforeEach(() => {
  fetchGroups.mockReset().mockResolvedValue(groupsResponse)
  fetchModels.mockReset().mockResolvedValue(modelsResponse)
  addGroup.mockReset().mockResolvedValue({ status: 201, body: {} })
  replaceGroup.mockReset().mockResolvedValue({ status: 200, body: {} })
  deleteGroup.mockReset().mockResolvedValue({ status: 204, body: null })
})

afterEach(() => {
  cleanup()
})

describe("Pi model groups tab", () => {
  it("lists groups with members and capacities", async () => {
    renderTab()
    expect(await screen.findByText("grp/g-mimo")).toBeTruthy()
    expect(screen.getByText("2 名成员")).toBeTruthy()
    expect(screen.getByText("alpha/model-a")).toBeTruthy()
    expect(screen.getByText("beta/model-b")).toBeTruthy()
  })

  it("adds a group with selected members", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "添加分组" }))
    fireEvent.change(await screen.findByLabelText("分组 id"), {
      target: { value: "g-new" },
    })
    await pickOption(/成员 1 Provider/, "alpha")
    await pickOption(/成员 1 模型/, "model-a")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(addGroup).toHaveBeenCalledTimes(1))
    expect(addGroup.mock.calls[0][0]).toMatchInlineSnapshot(`
      {
        "group": {
          "contextWindow": undefined,
          "maxTokens": undefined,
          "members": [
            {
              "modelId": "model-a",
              "provider": "alpha",
            },
          ],
          "name": "g-new",
        },
        "groupId": "g-new",
        "signature": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }
    `)
  })

  it("filters provider options by typed text", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "添加分组" }))
    const input = screen.getByRole("combobox", {
      name: /成员 1 Provider/,
    })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.change(input, { target: { value: "bet" } })
    expect(
      await within(document.body).findByRole("option", { name: "beta" })
    ).toBeTruthy()
    expect(
      within(document.body).queryByRole("option", { name: "alpha" })
    ).toBeNull()
  })

  it("blocks save when a member is incomplete", async () => {
    renderTab()
    fireEvent.click(await screen.findByRole("button", { name: "添加分组" }))
    fireEvent.change(await screen.findByLabelText("分组 id"), {
      target: { value: "g-half" },
    })
    await pickOption(/成员 1 Provider/, "alpha")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(
      await screen.findByText("成员必须同时选择 Provider 和模型")
    ).toBeTruthy()
    expect(addGroup).not.toHaveBeenCalled()
  })

  it("replaces an existing group", async () => {
    renderTab()
    fireEvent.click(
      await screen.findByRole("button", { name: "编辑分组 g-mimo" })
    )
    fireEvent.change(screen.getByLabelText("展示名"), {
      target: { value: "Mimo 池" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(replaceGroup).toHaveBeenCalledTimes(1))
    expect(replaceGroup.mock.calls[0][0]).toBe("g-mimo")
    expect(replaceGroup.mock.calls[0][1].group.name).toBe("Mimo 池")
  })

  it("deletes a group after confirmation", async () => {
    renderTab()
    fireEvent.click(
      await screen.findByRole("button", { name: "删除分组 g-mimo" })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "删除分组 g-mimo" })
    )
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledTimes(1))
    expect(deleteGroup.mock.calls[0][0]).toMatchInlineSnapshot(`
      {
        "groupId": "g-mimo",
        "signature": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }
    `)
  })
})
