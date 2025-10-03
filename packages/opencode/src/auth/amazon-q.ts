import z from "zod/v4"
import { Auth } from "./index"
import { NamedError } from "../util/error"
import { BunProc } from "../bun"

export namespace AuthAmazonQ {
  // Constants based on Amazon Q CLI implementation
  const CLIENT_NAME = "opencode"
  const CLIENT_TYPE = "public"
  const OIDC_REGION = "us-east-1"
  const START_URL = "https://view.awsapps.com/start"
  const SCOPES = ["codewhisperer:conversations", "codewhisperer:completions", "codewhisperer:analysis"]
  const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
  const REFRESH_GRANT_TYPE = "refresh_token"

  interface DeviceRegistration {
    client_id: string
    client_secret: string
    client_secret_expires_at?: number
    region: string
  }

  interface AmazonQToken {
    access_token: string
    refresh_token?: string
    expires_at: number
    region: string
    start_url: string
  }

  // Get OIDC endpoint URL for region
  function getOidcUrl(region: string): string {
    return `https://oidc.${region}.amazonaws.com`
  }

  // Register client with AWS SSO OIDC
  async function registerClient(region: string): Promise<DeviceRegistration> {
    const { SSOOIDCClient, RegisterClientCommand } = await import(await BunProc.install("@aws-sdk/client-sso-oidc"))

    const client = new SSOOIDCClient({
      region,
      endpoint: getOidcUrl(region),
    })

    const command = new RegisterClientCommand({
      clientName: CLIENT_NAME,
      clientType: CLIENT_TYPE,
      scopes: SCOPES,
    })

    const response = await client.send(command)

    return {
      client_id: response.clientId!,
      client_secret: response.clientSecret!,
      client_secret_expires_at: response.clientSecretExpiresAt,
      region,
    }
  }

  // Start device authorization flow
  export async function authorize(): Promise<{
    device: string
    user: string
    verification: string
    interval: number
    expiry: number
  }> {
    const region = OIDC_REGION

    // Get or create client registration
    let registration: DeviceRegistration
    const storedAuth = await Auth.get("amazon-q")

    if (storedAuth && storedAuth.type === "oauth") {
      // Try to get registration from a separate key for now
      const storedRegistration = await Auth.get("amazon-q-registration")
      if (storedRegistration && storedRegistration.type === "api") {
        registration = JSON.parse(storedRegistration.key)

        // Check if registration is expired
        if (registration.client_secret_expires_at &&
            registration.client_secret_expires_at < Date.now() / 1000) {
          registration = await registerClient(region)
          await Auth.set("amazon-q-registration", {
            type: "api",
            key: JSON.stringify(registration),
          })
        }
      } else {
        registration = await registerClient(region)
        await Auth.set("amazon-q-registration", {
          type: "api",
          key: JSON.stringify(registration),
        })
      }
    } else {
      registration = await registerClient(region)
      await Auth.set("amazon-q-registration", {
        type: "api",
        key: JSON.stringify(registration),
      })
    }

    const { SSOOIDCClient, StartDeviceAuthorizationCommand } = await import(await BunProc.install("@aws-sdk/client-sso-oidc"))

    const client = new SSOOIDCClient({
      region,
      endpoint: getOidcUrl(region),
    })

    const command = new StartDeviceAuthorizationCommand({
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      startUrl: START_URL,
    })

    const response = await client.send(command)

    return {
      device: response.deviceCode!,
      user: response.userCode!,
      verification: response.verificationUri!,
      interval: response.interval || 5,
      expiry: response.expiresIn!,
    }
  }

  // Poll for access token
  export async function poll(device_code: string): Promise<"pending" | "complete" | "failed"> {
    const region = OIDC_REGION
    const storedRegistration = await Auth.get("amazon-q-registration")

    if (!storedRegistration || storedRegistration.type !== "api") {
      return "failed"
    }

    const registration: DeviceRegistration = JSON.parse(storedRegistration.key)

    const { SSOOIDCClient, CreateTokenCommand } = await import(await BunProc.install("@aws-sdk/client-sso-oidc"))

    const client = new SSOOIDCClient({
      region,
      endpoint: getOidcUrl(region),
    })

    try {
      const command = new CreateTokenCommand({
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        grantType: DEVICE_GRANT_TYPE,
        deviceCode: device_code,
      })

      const response = await client.send(command)

      if (response.accessToken) {
        // Store the token
        const token: AmazonQToken = {
          access_token: response.accessToken,
          refresh_token: response.refreshToken,
          expires_at: Date.now() + (response.expiresIn! * 1000),
          region,
          start_url: START_URL,
        }

        await Auth.set("amazon-q", {
          type: "oauth",
          refresh: token.refresh_token || "",
          access: token.access_token,
          expires: token.expires_at,
        })

        return "complete"
      }

      return "pending"
    } catch (error: any) {
      if (error.name === "AuthorizationPendingException") {
        return "pending"
      }
      return "failed"
    }
  }

  // Get valid access token (refresh if needed)
  export async function access(): Promise<string | undefined> {
    const info = await Auth.get("amazon-q")
    if (!info || info.type !== "oauth") return

    // Check if token is still valid (with 1 minute buffer)
    if (info.expires > Date.now() + 60000) {
      return info.access
    }

    // Try to refresh token
    if (!info.refresh) return

    const region = OIDC_REGION
    const storedRegistration = await Auth.get("amazon-q-registration")

    if (!storedRegistration || storedRegistration.type !== "api") {
      return
    }

    const registration: DeviceRegistration = JSON.parse(storedRegistration.key)

    try {
      const { SSOOIDCClient, CreateTokenCommand } = await import(await BunProc.install("@aws-sdk/client-sso-oidc"))

      const client = new SSOOIDCClient({
        region,
        endpoint: getOidcUrl(region),
      })

      const command = new CreateTokenCommand({
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        grantType: REFRESH_GRANT_TYPE,
        refreshToken: info.refresh,
      })

      const response = await client.send(command)

      if (response.accessToken) {
        // Update stored token
        await Auth.set("amazon-q", {
          type: "oauth",
          refresh: response.refreshToken || info.refresh,
          access: response.accessToken,
          expires: Date.now() + (response.expiresIn! * 1000),
        })

        return response.accessToken
      }
    } catch (error) {
      // Refresh failed, remove invalid token
      await Auth.remove("amazon-q")
      return
    }
  }

  export const DeviceCodeError = NamedError.create("DeviceCodeError", z.object({}))

  export const TokenExchangeError = NamedError.create(
    "TokenExchangeError",
    z.object({
      message: z.string(),
    }),
  )

  export const AuthenticationError = NamedError.create(
    "AuthenticationError",
    z.object({
      message: z.string(),
    }),
  )

}