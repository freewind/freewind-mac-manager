import { login } from "@shared/client-api"
import { describeError } from "@shared/format"
import { Alert, AlertDescription } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { type FormEvent, useState } from "react"

type LoginPageProps = {
  configured: boolean
  onAuthenticated: () => void
}

export const LoginPage = ({ configured, onAuthenticated }: LoginPageProps) => {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(password)
      setPassword("")
      onAuthenticated()
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <form
        className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
        onSubmit={submit}
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Mac Manager</h1>
          <p className="text-sm text-muted-foreground">
            登录以访问本机控制面板
          </p>
        </div>
        {configured ? (
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              autoComplete="current-password"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
              className="h-11"
            />
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              服务尚未配置密码。请设置 MAC_MANAGER_PASSWORD 后重启。
            </AlertDescription>
          </Alert>
        )}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {configured ? (
          <Button className="h-11 w-full" type="submit" disabled={submitting}>
            {submitting ? "正在登录…" : "登录"}
          </Button>
        ) : null}
      </form>
    </main>
  )
}
