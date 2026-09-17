import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const root = path.dirname(fileURLToPath(import.meta.url))

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Expected exactly one packaging anchor: ' + before)
  return source.replace(before, () => after)
}

export async function buildNibiMembers() {
  const [template, controller, chat, portfolio] = await Promise.all([
    fs.readFile(path.join(root, 'templates/nibi-members.html'), 'utf8'),
    fs.readFile(path.join(root, 'templates/nibi-members.js'), 'utf8'),
    fs.readFile(path.join(root, 'components/chat-sidebar.js'), 'utf8'),
    fs.readFile(path.join(root, 'components/graph-portfolio.js'), 'utf8'),
  ])
  for (const source of [controller, chat, portfolio]) new Script(source)
  const dataScript = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  let runtime = replaceOnce(controller, "  const scriptBase = new URL('.', document.currentScript.src)\n", '')
  runtime = replaceOnce(runtime, "new URL('../components/chat-sidebar.js', scriptBase).href", JSON.stringify(dataScript(chat)))
  runtime = replaceOnce(runtime, "new URL('../components/graph-portfolio.js', scriptBase).href", JSON.stringify(dataScript(portfolio)))
  new Script(runtime)
  return replaceOnce(template, '<script src="nibi-members.js" defer></script>', '<script>' + runtime.replace(/<\/script/gi, '<\\/script') + '</script>')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.resolve(root, '../outputs/nibi-members/nibi-members.html')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const html = await buildNibiMembers()
  await fs.writeFile(destination, html)
  console.log(destination + ' (' + Buffer.byteLength(html) + ' bytes)')
}