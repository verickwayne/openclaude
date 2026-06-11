export const WEB_BROWSER_TOOL_NAME = 'WebBrowser'

export const DESCRIPTION = `
- Provides native web browsing without relying on provider-native search or paid search API credits
- Supports searching the web and opening URLs
- Returns search results or compact page markdown directly for the current model to inspect
- Does not call a secondary model to summarize fetched content

Actions:
  - search: search the web for a query and return result titles, URLs, and snippets
  - open: open a URL and return extracted markdown/text content

Usage notes:
  - Use WebBrowser when you need provider-independent browsing for any model
  - Use search before open when the user asks for current information but does not provide a URL
  - Use open when the user provides a URL or after search returns a relevant URL
  - Opened pages default to content_mode="compact" to reduce context usage
  - Use content_mode="full" only when the compact view is not enough
  - Include source URLs in your final answer when using results from this tool
  - This tool is read-only and does not modify files
`
