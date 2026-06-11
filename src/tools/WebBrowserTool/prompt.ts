export const WEB_BROWSER_TOOL_NAME = 'WebBrowser'

export const DESCRIPTION = `
- Provides native web browsing without relying on provider-native search or paid search API credits
- Supports searching the web, opening URLs, navigating live pages, clicking, typing, extracting page text/links/elements, and taking screenshots
- Returns search results or compact page markdown directly for the current model to inspect
- Does not call a secondary model to summarize fetched content

Actions:
  - search: search the web for a query and return result titles, URLs, and snippets
  - open: open a URL and return extracted markdown/text content
  - navigate: open a URL in a live Playwright-controlled browser page
  - click: click a CSS selector or visible text on the current live page
  - type: fill a field on the current live page
  - screenshot: save a PNG screenshot of the current live page and return its path
  - text: extract compact visible text from the current live page
  - links: list links from the current live page
  - elements: list visible clickable/form/media elements with selectors

Usage notes:
  - Use WebBrowser when you need provider-independent browsing for any model
  - Use search before open when the user asks for current information but does not provide a URL
  - Use open when the user provides a URL or after search returns a relevant URL
  - Use navigate/click/type/elements for pages that require interaction, pagination, comments expansion, tabs, or dynamic content
  - Use screenshot when visual layout, images, charts, or video frames matter; inspect the returned image path with the file/image read tool when vision analysis is needed
  - Opened pages default to content_mode="compact" to reduce context usage
  - Use content_mode="full" only when the compact view is not enough
  - Include source URLs in your final answer when using results from this tool
  - This tool is read-only and does not modify files
`
