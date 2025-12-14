import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { setDevUser } from "@/lib/devUser"

export default function RegisterPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const register = () => {
    // Per your instruction: no real auth. Always register as dev user.
    setDevUser()
    navigate("/home", { replace: true })
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Enter your email below to register your account</CardDescription>
          <CardAction>
            <Button variant="link" type="button" onClick={() => navigate("/", { replace: false })}>
              Back
            </Button>
          </CardAction>
        </CardHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void email
            void password
            register()
          }}
        >
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex-col gap-2 pt-4">
            <Button type="submit" className="w-full">
              Register
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => register()}>
              Register with Google
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}


