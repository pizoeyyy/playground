export const AGENT_PATH = '/__playground/agent.js';

/** Put the agent script first in <head> so it can patch history before the page's own scripts run. */
export function injectAgent(html: string, editorOrigin: string): string {
  if (html.includes(AGENT_PATH)) return html;
  const tag = `<script src="${AGENT_PATH}?editor=${encodeURIComponent(editorOrigin)}"></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length);
  return tag + html;
}
