(function () {
  'use strict'

  const scriptBase = new URL('.', document.currentScript.src)
  const chatComponent = new URL('../components/chat-sidebar.js', scriptBase).href
  const portfolioComponent = new URL('../components/graph-portfolio.js', scriptBase).href
  const identityApi = 'https://vegvisr-frontend.torarnehave.workers.dev'
  const worldConfigApi = 'https://knowledge-graph-worker.torarnehave.workers.dev'
  const chatApi = 'https://group-chat-worker.torarnehave.workers.dev'
  const worldDomain = 'nibi.no'
  const magicApi = 'https://cookie.vegvisr.org'
  const sessionKey = 'nibi_member_token'
  const tabs = ['chat', 'meeting', 'articles', 'common', 'personal']
  const teamMeetingId = 'bbb3cdd1-e34c-4b29-86b4-4281c0eecae0'
  const realtimeApp = 'https://realtime.vegvisr.org/'
  const element = id => document.getElementById(id)
  let session = null
  let generation = 0
  let controller = new AbortController()
  let groups = []
  let activeGroup = null
  let groupTimer = null
  let loadingGroups = false
  let portfolioLoaded = false

  function status(id, text, error = false) {
    const target = element(id)
    target.textContent = text
    target.dataset.error = String(error)
  }

  function screen(id) {
    for (const name of ['login', 'checking', 'member']) element(name).hidden = name !== id
    element('account').hidden = id !== 'member'
  }

  function clearChat() {
    element('chatHost').replaceChildren()
    element('chatTitle').textContent = 'Velg en samtale'
    element('chatLayout').dataset.open = 'false'
  }

  function resetSession() {
    generation += 1
    controller.abort()
    controller = new AbortController()
    clearInterval(groupTimer)
    groupTimer = null
    session = null
    groups = []
    activeGroup = null
    loadingGroups = false
    clearChat()
    element('personalHost').replaceChildren()
    element('commonHost').replaceChildren()
    element('meetingHost').replaceChildren()
    element('groupList').replaceChildren()
    element('groupSearch').value = ''
    element('identity').textContent = ''
    element('refresh').disabled = false
    element('sendLink').disabled = false
    document.querySelector('.vgp-back:not([hidden]) .vgp-close')?.click()
  }

  function signOut(message = '') {
    resetSession()
    try { sessionStorage.removeItem(sessionKey) } catch {}
    screen('login')
    status('loginStatus', message, Boolean(message))
  }

  async function json(url, options = {}) {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.success === false) {
      const error = new Error(data.error || 'Foresp\u00f8rselen kunne ikke fullf\u00f8res (' + response.status + ').')
      error.status = response.status
      throw error
    }
    return data
  }

  function groupQuery() {
    return new URLSearchParams({ user_id: session.user.user_id, phone: session.user.phone, email: session.user.email })
  }

  function renderGroups() {
    const search = element('groupSearch').value.trim().toLocaleLowerCase('nb')
    element('groupList').replaceChildren()
    const visible = groups.filter(group => String(group.name || '').toLocaleLowerCase('nb').includes(search))
    for (const group of visible) {
      const button = document.createElement('button')
      button.className = 'group'
      button.type = 'button'
      button.setAttribute('aria-pressed', String(activeGroup?.id === group.id))
      const name = document.createElement('strong')
      name.textContent = group.name || 'Samtale'
      const role = document.createElement('small')
      role.textContent = ({ owner: 'Eier', admin: 'Administrator', member: 'Medlem' })[group.role] || 'Medlem'
      button.append(name, role)
      button.addEventListener('click', () => openGroup(group))
      element('groupList').append(button)
    }
    status('groupStatus', groups.length ? (visible.length ? groups.length + (groups.length === 1 ? ' gruppe' : ' grupper') : 'Ingen grupper matcher s\u00f8ket.') : 'Du er ikke medlem av noen chatgrupper enn\u00e5.')
  }

  function openGroup(group) {
    if (!session || !groups.some(item => item.id === group.id)) return
    clearChat()
    activeGroup = group
    renderGroups()
    element('chatTitle').textContent = group.name || 'Samtale'
    element('chatLayout').dataset.open = 'true'
    const frame = document.createElement('iframe')
    frame.title = group.name || 'Chat'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups')
    frame.referrerPolicy = 'no-referrer'
    const capturedSession = session
    frame.addEventListener('load', () => {
      if (!frame.isConnected || session !== capturedSession || activeGroup?.id !== group.id) return
      const page = frame.contentDocument
      const marker = page.createElement('div')
      marker.setAttribute('data-vegvisr-chat', group.id)
      marker.setAttribute('data-session-token', capturedSession.token)
      marker.setAttribute('data-title', group.name || 'Chat')
      marker.setAttribute('data-start', 'open')
      marker.setAttribute('data-lang', 'no')
      marker.setAttribute('data-chat-api', chatApi)
      marker.setAttribute('data-identity-api', identityApi)
      page.body.append(marker)
      const script = page.createElement('script')
      script.src = chatComponent
      script.onerror = () => { page.body.textContent = 'Chatten kunne ikke lastes. Velg gruppen igjen for \u00e5 pr\u00f8ve p\u00e5 nytt.' }
      page.body.append(script)
    }, { once: true })
    frame.srcdoc = '<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;font-family:"Source Sans 3",sans-serif;--v-primary:#17634b;--v-bg:#fff;--v-text:#202c29;--v-surface:#edf3ef}*{box-sizing:border-box}.vcs-panel{width:100%!important;box-shadow:none!important;border:0!important}.vcs-bar,.vcs-launch{display:none!important}.vcs-body{min-height:0}.vcs-in{min-width:0;width:0}.vcs-msg{max-width:95%!important}.vcs-bub{overflow-wrap:anywhere}.vcs-bub audio{max-width:100%}button,textarea{font:inherit}</style></head><body></body></html>'
    element('chatHost').append(frame)
  }

  async function loadGroups() {
    if (!session || loadingGroups) return
    if (!session.user.phone) {
      status('groupStatus', 'Telefonnummer mangler i profilen. Chat krever et registrert telefonnummer.', true)
      return
    }
    const requestGeneration = generation
    loadingGroups = true
    element('refresh').disabled = true
    status('groupStatus', 'Henter grupper ...')
    try {
      const data = await json(worldConfigApi + '/world-chat-groups?domain=' + encodeURIComponent(worldDomain) + '&email=' + encodeURIComponent(session.user.email), {
        headers: { 'X-API-Token': session.token },
      })
      if (generation !== requestGeneration) return
      if (!Array.isArray(data.groups)) throw new Error('Ugyldig svar fra chat-tjenesten.')
      groups = data.groups.slice().sort((first, second) => second.updated_at - first.updated_at)
      if (activeGroup && !groups.some(group => group.id === activeGroup.id)) {
        activeGroup = null
        clearChat()
      }
      renderGroups()
    } catch (error) {
      if (generation !== requestGeneration || error.name === 'AbortError') return
      if (error.status === 401 || error.status === 403) {
        clearChat()
        activeGroup = null
        groups = []
        element('groupList').replaceChildren()
      }
      status('groupStatus', error.message + ' Bruk Oppdater for \u00e5 pr\u00f8ve igjen.', true)
    } finally {
      if (generation === requestGeneration) {
        loadingGroups = false
        element('refresh').disabled = false
      }
    }
  }

  function formatCommonSections(page) {
    const grid = page.querySelector('.vgp-sections')
    if (!grid || grid.dataset.formatted) return
    grid.dataset.formatted = 'true'
    let testData = false
    const sectionTypes = {
      '3a694b63-5a3c-4465-bfe6-540338276904': 'aktuelt',
      '2a02acad-f056-48c3-925c-b0e6b8633ac1': 'kalender',
    }
    const sections = Array.from(grid.querySelectorAll(':scope > section'))
    const rank = section => ({ aktuelt: 0, kalender: 1 })[sectionTypes[section.dataset.nodeId]] ?? 2
    sections.sort((first, second) => rank(first) - rank(second))
    const make = (tag, className, text) => {
      const node = page.createElement(tag)
      node.className = className
      if (text) node.textContent = text
      return node
    }
    for (const section of sections) {
      grid.append(section)
      const sectionType = sectionTypes[section.dataset.nodeId]
      if (!sectionType) {
        section.classList.add('common-fullwidth')
        continue
      }
      const heading = section.querySelector(':scope > h2')
      const content = section.querySelector('.vgp-node')
      if (!heading || !content) continue
      const calendar = sectionType === 'kalender'
      section.id = sectionType
      const header = make('div', 'section-heading')
      heading.replaceWith(header)
      header.append(heading, make('span', 'small', calendar ? 'Kommende' : 'Fra administrator'))
      let article = null
      let details = null
      for (const node of Array.from(content.childNodes)) {
        if (node.nodeType === 1 && node.matches('p') && /^TESTDATA\s/.test(node.textContent.trim())) {
          testData = true
          node.remove()
          continue
        }
        if (node.nodeType !== 1) {
          ;(details || article || content).append(node)
          continue
        }
        if (!calendar) {
          if (node.matches('h3')) {
            article = make('article', 'news')
            content.append(article)
          } else if (node.matches('hr')) {
            article = null
            node.remove()
            continue
          }
          if (article) {
            article.append(node)
            if (node.matches('p') && /^\d{1,2}\.\s/.test(node.textContent.trim()) && node.querySelector('em')) {
              node.className = 'meta'
              node.textContent = node.textContent
              article.prepend(node)
            }
          } else content.append(node)
        } else {
          if (node.matches('h3')) {
            article = null
            details = null
            content.append(make('p', 'month', node.textContent))
            node.remove()
            continue
          }
          const event = node.matches('p') && node.querySelector(':scope > strong') && node.textContent.trim().match(/^(\d{1,2})\.\s+[^\u00b7]+\u00b7\s+(.+)$/)
          if (event) {
            const timing = node.nextElementSibling
            const weekday = timing?.textContent.trim().match(/^(Mandag|Tirsdag|Onsdag|Torsdag|Fredag|L\u00f8rdag|S\u00f8ndag)\s+kl\.\s*/i)
            if (weekday) {
              article = make('article', 'event')
              const date = make('div', 'date')
              date.append(make('strong', '', event[1].padStart(2, '0')), make('span', '', weekday[1].slice(0, 3).toLocaleUpperCase('nb')))
              details = make('div', 'event-content')
              details.append(make('p', 'meta', timing.textContent.trim().slice(weekday[0].length)), make('h3', '', event[2]))
              article.append(date, details)
              content.append(article)
              timing.remove()
              node.remove()
              continue
            }
          }
          if (node.matches('hr')) {
            article = null
            details = null
            node.remove()
            continue
          }
          if (!node.isConnected) continue
          ;(details || content).append(node)
          if (node.matches('p') && node.querySelector(':scope > em')) {
            node.className = 'meta'
            node.textContent = node.textContent
          }
        }
      }
      for (const paragraph of content.querySelectorAll('p')) {
        const image = paragraph.querySelector(':scope > img')
        if (!image || paragraph.textContent.trim()) continue
        const caption = paragraph.nextElementSibling
        const figure = make('figure', 'photo')
        paragraph.replaceWith(figure)
        figure.append(image)
        if (caption?.matches('p') && caption.querySelector('em')) {
          figure.append(make('figcaption', '', caption.textContent))
          caption.remove()
        }
      }
    }
    if (testData) grid.before(make('div', 'preview', 'TESTDATA \u00b7 Eksempelinnhold, ikke publiserte beskjeder eller arrangementer'))
  }

  function openMemberGraph(kind) {
    const common = kind === 'common'
    const host = element(kind + 'Host')
    host.replaceChildren()
    if (!session) return
    if (!common && (session.user.user_id !== 'ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b' || session.user.email.toLowerCase() !== 'torarnehave@gmail.com')) {
      host.textContent = 'Ingen medlemsgraf er koblet til din konto enn\u00e5.'
      return
    }
    const capturedSession = session
    const frame = document.createElement('iframe')
    frame.title = common ? 'NIBI Felles: Aktuelt og Kalender' : 'Min medlemsgraf'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups')
    frame.referrerPolicy = 'no-referrer'
    frame.addEventListener('load', () => {
      if (!frame.isConnected || session !== capturedSession) return
      const page = frame.contentDocument
      const marker = page.createElement('div')
      marker.setAttribute('data-vegvisr-portfolio', common ? '#NIBI #FELLES' : '')
      marker.setAttribute('data-portfolio-graph', common ? '37772e96-dea0-4c4e-b3d3-b7d4cc4eb6e4' : 'd85adc91-f862-480a-80ae-8d6462f7f153')
      marker.setAttribute('data-include', common ? 'published' : 'public')
      if (common) marker.setAttribute('data-display', 'sections')
      marker.setAttribute('data-open', 'modal')
      marker.setAttribute('data-lang', 'no')
      page.body.append(marker)
      const script = page.createElement('script')
      script.src = portfolioComponent
      script.onerror = () => { page.body.textContent = 'Grafen kunne ikke lastes. Velg fanen igjen for \u00e5 pr\u00f8ve p\u00e5 nytt.' }
      page.head.append(script)
      if (common) {
        const observer = new frame.contentWindow.ResizeObserver(() => {
          formatCommonSections(page)
          if (frame.isConnected) frame.style.height = Math.ceil(page.body.getBoundingClientRect().height + 24) + 'px'
        })
        observer.observe(page.body)
        frame.contentWindow.addEventListener('pagehide', () => observer.disconnect(), { once: true })
      }
    }, { once: true })
    frame.srcdoc = '<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;font-family:"Source Sans 3",sans-serif;--v-primary:#17634b;--v-text:#202c29;--v-bg:#fff;--v-surface:#f0f5f2}*{box-sizing:border-box}.vgp-sections{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:44px;padding:16px 0}.vgp-sections>section{min-width:0;overflow-wrap:anywhere}.vgp-sections>section+section{border-left:1px solid #d8e1dc;padding-left:32px}.vgp-sections h2{font-size:25px;font-weight:600;margin:0 0 24px}.vgp-sections h3{font-size:20px;font-weight:600;margin:24px 0 12px}.vgp-sections p,.vgp-sections li{font-size:17px;line-height:1.6}.vgp-sections img,.vgp-sections video{max-width:100%;height:auto}.vgp-sections table{display:block;max-width:100%;overflow:auto}.vgp-sections pre{white-space:pre-wrap}.vgp-sections a{color:#17634b}@media(max-width:680px){.vgp-sections{grid-template-columns:minmax(0,1fr);gap:24px}.vgp-sections>section+section{border-left:0;border-top:1px solid #d8e1dc;padding:24px 0 0}}</style></head><body></body></html>'
    if (common) frame.srcdoc = `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap">
      <style>
        :root{font-family:"Source Sans 3",sans-serif;color:#202c29;--green:#17634b;--muted:#56645f;--line:#d8e1dc;letter-spacing:0}
        *{box-sizing:border-box}body{margin:0}a{color:var(--green);text-underline-offset:4px}
        .preview{background:#f3eaf0;color:#703349;font-size:13px;padding:8px 24px;text-align:center}
        .vgp-sections{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:44px;border-top:1px solid var(--line)}
        .vgp-sections>section{padding:32px 0;border-bottom:1px solid var(--line);min-width:0;overflow-wrap:anywhere}
        .vgp-sections>.common-fullwidth{grid-column:1 / -1}.common-fullwidth>h2{margin-bottom:23px}
        #kalender{border-left:1px solid var(--line);padding-left:32px}
        h2{font-size:25px;font-weight:600;margin:0;line-height:1.2}h3{font-size:20px;line-height:1.3;margin:0 0 8px;font-weight:600}
        p{line-height:1.6;margin:0 0 12px}.section-heading{display:flex;align-items:baseline;gap:16px;justify-content:space-between;margin-bottom:23px}
        .section-heading .small{color:var(--muted);font-size:14px}.month{color:var(--green);font-size:14px;font-weight:600;margin:24px 0 16px}
        .news{padding:22px 0;border-top:1px solid var(--line)}.news:first-of-type{padding-top:0;border-top:0}.news p{max-width:630px}
        .meta{color:var(--muted);font-size:13px;margin-bottom:7px}.event{display:grid;grid-template-columns:60px minmax(0,1fr);gap:18px;padding:18px 0;border-bottom:1px solid var(--line)}
        .event h3{font-size:18px}.event p{font-size:15px}.date{border-top:3px solid var(--green);padding:10px 0;text-align:center;background:#edf3ef;align-self:start}
        .date strong{display:block;font-size:24px;font-weight:600}.date span{display:block;font-size:13px;color:var(--muted)}
        .photo{margin:18px 0 0}.photo img{width:100%;height:auto;aspect-ratio:16/5;object-fit:cover;display:block;border-radius:4px}.photo figcaption{color:var(--muted);font-size:12px;padding-top:7px}
        img,video{max-width:100%;height:auto}table{display:block;max-width:100%;overflow:auto}pre{white-space:pre-wrap}
        @media(max-width:900px){.vgp-sections{gap:24px}#kalender{padding-left:24px}}
        @media(max-width:680px){.vgp-sections{grid-template-columns:minmax(0,1fr);gap:0}#kalender{border-left:0;padding-left:0}.vgp-sections>section{padding-block:27px}.section-heading{align-items:flex-start;flex-wrap:wrap;gap:8px}.event{grid-template-columns:64px minmax(0,1fr);gap:15px}.photo img{aspect-ratio:16/7}.preview{text-align:left;padding-inline:18px}}
      </style></head><body></body></html>`
    host.append(frame)
  }

  async function openRealtimeMeeting() {
    const host = element('meetingHost')
    host.replaceChildren()
    if (!session?.token || !session.user?.email) return
    status('meetingStatus', 'Kobler til NIBI team-rommet ...')
    try {
      const data = await json('https://api.vegvisr.org/realtime/join-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': session.token },
        body: JSON.stringify({
          meetingId: teamMeetingId,
          clientData: { customParticipantId: session.user.email, name: session.user.email.split('@')[0].replace(/[._-]/g, ' ') },
        }),
      })
      if (!data.authToken) throw new Error(data.error || 'Møte-token mangler.')
      const capturedSession = session
      const frame = document.createElement('iframe')
      frame.title = 'NIBI møte'
      frame.allow = 'camera; microphone; display-capture; fullscreen; autoplay'
      frame.referrerPolicy = 'no-referrer'
      const target = realtimeApp + '?meetingId=' + encodeURIComponent(teamMeetingId) + '&embed=1'
      const sendBootstrap = () => {
        if (!frame.isConnected || session !== capturedSession) {
          window.removeEventListener('message', handleReady)
          return
        }
        frame.contentWindow?.postMessage({
          type: 'NIBI_REALTIME_BOOTSTRAP',
          meetingId: teamMeetingId,
          authToken: data.authToken,
          isOwner: data.isOwner === true,
        }, 'https://realtime.vegvisr.org')
        status('meetingStatus', data.isOwner ? 'Du er møte-leder.' : 'Du er deltaker i NIBI team-rommet.')
      }
      const handleReady = event => {
        if (event.origin !== 'https://realtime.vegvisr.org' || event.source !== frame.contentWindow) return
        if (event.data?.type === 'VEGVISR_REALTIME_READY' && event.data.meetingId === teamMeetingId) sendBootstrap()
      }
      window.addEventListener('message', handleReady)
      frame.addEventListener('load', sendBootstrap, { once: true })
      frame.addEventListener('load', () => {
        setTimeout(sendBootstrap, 250)
      }, { once: true })
      frame.addEventListener('load', () => {
        setTimeout(sendBootstrap, 1000)
      }, { once: true })
      frame.src = target
      host.append(frame)
      frame.addEventListener('load', () => {
        if (!frame.isConnected) window.removeEventListener('message', handleReady)
      }, { once: true })
    } catch (error) {
      status('meetingStatus', error.message || 'Møtet kunne ikke lastes.', true)
    }
  }

  for (const link of document.querySelectorAll('[data-common-section]')) {
    link.addEventListener('click', event => {
      const frame = element('commonHost').querySelector('iframe')
      const target = frame?.contentDocument?.getElementById(link.dataset.commonSection)
      if (!target) return
      event.preventDefault()
      window.scrollTo({ top: window.scrollY + frame.getBoundingClientRect().top + target.getBoundingClientRect().top - 20 })
    })
  }

  function selectTab(name) {
    element('personalHost').replaceChildren()
    element('commonHost').replaceChildren()
    for (const tab of tabs) {
      element(tab + 'Tab').setAttribute('aria-selected', String(tab === name))
      element(tab + 'Tab').tabIndex = tab === name ? 0 : -1
      element(tab + 'Section').hidden = tab !== name
    }
    if (name === 'meeting') {
      clearChat()
      openRealtimeMeeting()
    } else if (name === 'personal' || name === 'common') {
      clearChat()
      openMemberGraph(name)
    } else if (name !== 'chat') {
      clearChat()
      if (!portfolioLoaded) {
        portfolioLoaded = true
        status('articleStatus', 'Henter artikler ...')
        const script = document.createElement('script')
        script.src = portfolioComponent
        script.onload = () => status('articleStatus', '')
        script.onerror = () => {
          portfolioLoaded = false
          script.remove()
          status('articleStatus', 'Artiklene kunne ikke lastes. Velg Artikler igjen for \u00e5 pr\u00f8ve p\u00e5 nytt.', true)
        }
        document.head.append(script)
      }
    } else if (activeGroup) openGroup(activeGroup)
  }

  async function authenticate(token, magic = false) {
    resetSession()
    screen('checking')
    const requestGeneration = generation
    try {
      if (magic) {
        const result = await json(magicApi + '/login/magic/verify?token=' + encodeURIComponent(token))
        if (generation !== requestGeneration) return
        if (!result.apiToken) throw new Error('Innloggingslenken ga ingen gyldig sesjon.')
        token = result.apiToken
      }
      const user = await json(identityApi + '/userdata-from-token', { headers: { Authorization: 'Bearer ' + token } })
      if (generation !== requestGeneration) return
      if (!user.email || !user.user_id) throw new Error('Brukerprofilen mangler e-post eller bruker-ID.')
      session = { token, user }
      try { sessionStorage.setItem(sessionKey, token) } catch {}
      element('identity').textContent = user.email
      screen('member')
      selectTab(new URL(location.href).searchParams.has('vgp') ? 'articles' : 'chat')
      await loadGroups()
      if (generation !== requestGeneration) return
      groupTimer = setInterval(() => { if (!document.hidden) loadGroups() }, 30000)
    } catch (error) {
      if (generation === requestGeneration && error.name !== 'AbortError') signOut(error.message)
    }
  }

  function restorePreview() {
    const previewUser = window.__VEGVISR_USER
    if (!previewUser?.email) return false
    resetSession()
    session = {
      token: window.__VEGVISR_TOKEN || '',
      user: { email: previewUser.email, user_id: previewUser.user_id || 'agent-builder-preview', phone: null, role: previewUser.role || 'Superadmin' },
    }
    element('identity').textContent = session.user.email
    screen('member')
    selectTab('common')
    status('groupStatus', 'Previewmodus: chatgrupper lastes ikke i forhåndsvisningen.')
    return true
  }

  element('loginForm').addEventListener('submit', async event => {
    event.preventDefault()
    const requestGeneration = generation
    element('sendLink').disabled = true
    status('loginStatus', 'Sender innloggingslenke ...')
    try {
      const redirect = new URL(location.href)
      const articleId = redirect.searchParams.get('vgp')
      redirect.search = ''
      redirect.hash = ''
      if (articleId) redirect.searchParams.set('vgp', articleId)
      await json(magicApi + '/login/magic/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: element('email').value.trim(), redirectUrl: redirect.href }),
      })
      if (generation === requestGeneration) status('loginStatus', 'Sjekk e-posten din for innloggingslenken.')
    } catch (error) {
      if (generation === requestGeneration && error.name !== 'AbortError') status('loginStatus', error.message, true)
    } finally {
      if (generation === requestGeneration) element('sendLink').disabled = false
    }
  })
  element('signout').addEventListener('click', () => signOut())
  element('refresh').addEventListener('click', loadGroups)
  element('groupSearch').addEventListener('input', renderGroups)
  element('back').addEventListener('click', () => { clearChat(); activeGroup = null; renderGroups() })
  for (const name of tabs) {
    element(name + 'Tab').addEventListener('click', () => selectTab(name))
    element(name + 'Tab').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(name) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      selectTab(next)
      element(next + 'Tab').focus()
    })
  }
  window.addEventListener('pagehide', resetSession)
  window.addEventListener('pageshow', event => { if (event.persisted) restore() })
  window.addEventListener('storage', event => { if (event.key === sessionKey && !event.newValue) signOut() })

  function restore() {
    if (restorePreview()) return
    const url = new URL(location.href)
    const magic = url.searchParams.get('magic')
    if (magic) {
      url.searchParams.delete('magic')
      history.replaceState({}, '', url)
      authenticate(magic, true)
      return
    }
    let stored = null
    try { stored = sessionStorage.getItem(sessionKey) } catch {}
    if (stored) authenticate(stored)
    else screen('login')
  }

  restore()
})()