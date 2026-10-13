import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a']

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Düz metni (satır sonları, linkler, "- " madde işaretleri) güvenli HTML'e çevirir. */
export function plainToHtml(text: string): string {
  const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
  const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${bold(linkify(escapeHtml(l.replace(/^\s*[-•*]\s+/, ''))))}</li>`).join('')}</ul>`
      }
      return `<p>${lines.map((l) => bold(linkify(escapeHtml(l)))).join('<br>')}</p>`
    })
    .join('')
}

/** Kayıtlı HTML'i düzenleme için düz metne geri çevirir. */
export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(sanitize(html), 'text/html')
  const blocks: string[] = []
  doc.body.childNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      if (node.textContent?.trim()) blocks.push(node.textContent)
      return
    }
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      blocks.push(Array.from(node.querySelectorAll('li')).map((li) => `- ${inline(li)}`).join('\n'))
    } else {
      blocks.push(inline(node))
    }
  })
  return blocks.join('\n\n')
}

function inline(el: HTMLElement): string {
  let out = ''
  el.childNodes.forEach((n) => {
    if (n instanceof HTMLBRElement) out += '\n'
    else if (n instanceof HTMLElement && (n.tagName === 'B' || n.tagName === 'STRONG')) out += `**${n.textContent ?? ''}**`
    else out += n.textContent ?? ''
  })
  return out
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
}
