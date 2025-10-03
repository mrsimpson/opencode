import type { Plugin } from "@opencode-ai/plugin"
import { AuthAmazonQ } from "./amazon-q"

export const amazonQAuth: Plugin = async (_input) => {
  return {
    auth: {
      provider: "amazon-q",
      methods: [
        {
          type: "oauth",
          label: "Amazon Q Developer",
          async authorize() {
            const auth = await AuthAmazonQ.authorize()

            return {
              url: auth.verification,
              instructions: `Enter code: ${auth.user}`,
              method: "auto",
              async callback() {
                const maxAttempts = Math.floor(auth.expiry / auth.interval)
                let attempts = 0

                while (attempts < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, auth.interval * 1000))

                  const result = await AuthAmazonQ.poll(auth.device)

                  if (result === "complete") {
                    // Get the stored token info to return proper format
                    const tokenInfo = await AuthAmazonQ.access()
                    if (tokenInfo) {
                      // The token is already stored by the poll function,
                      // but we need to return it in the expected format
                      return {
                        type: "success" as const,
                        refresh: "", // Amazon Q handles refresh internally
                        access: tokenInfo,
                        expires: Date.now() + (24 * 60 * 60 * 1000), // 24 hours placeholder
                      }
                    }
                  }

                  if (result === "failed") {
                    return { type: "failed" as const }
                  }

                  attempts++
                }

                return { type: "failed" as const }
              },
            }
          },
        },
      ],
      async loader() {
        // This function provides options for the provider
        // Amazon Q auth is handled internally via the custom loader
        return {}
      },
    },
  }
}