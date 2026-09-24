// REFERENCE COPY of template:brand-proxy in WORLD_TEMPLATES KV, as deployed 2026-09-24.
// The KV key is the SOURCE — deploy_world_proxy reads it, not this file. This copy exists because
// that template once drifted seven months from any reviewable source, and a change nobody can read
// is a change nobody can check. Update BOTH when changing the proxy, and keep the KV backup key
// (template:brand-proxy.backup-<date>) so a rollback is one put away.
//
// Existing World proxies keep running the script they were deployed with: a change here reaches a
// World only when deploy_world_proxy runs for it again.

// Serve-time injection: if a published page contains a contact-form marker
// (data-vegvisr-contact) but not yet the component script, inject it so the
// SSOT web component (served from the Component Registry graph) mounts live.
// Idempotent; no-op for pages without the marker. Mirrors brand-worker.
const injectContactFormScript = (html) => {
  if (!html || html.indexOf('data-vegvisr-contact') === -1) return html;
  if (html.indexOf('/components/contact-form.js') !== -1) return html;
  const tag =
    '<script src="https://api.vegvisr.org/components/contact-form.js" defer></script>';
  if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>');
  return html + tag;
};

// A published page is a public snapshot read from KV — identical bytes for every caller, no
// cookies or auth consulted — so any origin may READ it. Without these headers a component on
// another origin cannot fetch a site's page to discover its <link rel="icon">: the browser
// blocks the response even though the page is public to anyone with the URL (2026-08-21).
const CORS_READ_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// www.<host> falls back to the apex key, matching how pages are published.
const htmlKeysFor = (hostname) => {
  const keys = [`html:${hostname}`];
  if (hostname.startsWith('www.')) keys.push(`html:${hostname.replace(/^www\./, '')}`);
  return keys;
};

// These hosts have no /favicon.ico — the icon is declared ONLY in <link rel="...icon"> tags in
// the head, at an arbitrary URL. Parsed with HTMLRewriter, which is native to Workers, rather
// than a regex, so attribute order and quoting can't break it.
const extractIcons = async (html, hostname) => {
  const icons = [];
  const rewriter = new HTMLRewriter().on('link', {
    element(el) {
      const rel = String(el.getAttribute('rel') || '').toLowerCase();
      if (!/(^|[\s-])icon(\s|$)/.test(rel)) return;
      const href = String(el.getAttribute('href') || '').trim();
      if (!href) return;
      let abs = href;
      try {
        abs = new URL(href, `https://${hostname}/`).href;
      } catch {}
      const sizes = el.getAttribute('sizes') || null;
      const px = sizes
        ? Math.max(0, ...String(sizes).toLowerCase().split(/\s+/).map((s) => parseInt(s, 10) || 0))
        : 0;
      icons.push({ rel, href: abs, sizes, type: el.getAttribute('type') || null, px });
    },
  });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return icons;
};

// A raster icon beats apple-touch beats mask-icon (mask-icon is a monochrome SVG silhouette and
// renders as a black blob in a nav bar); within a tier the largest declared size wins.
const pickBestIcon = (icons) => {
  const rank = (i) => (i.rel.includes('mask') ? 0 : i.rel.includes('apple') ? 1 : 2);
  return [...icons].sort((a, b) => rank(b) - rank(a) || b.px - a.px)[0] || null;
};

export default {
  async fetch(request, env) {
    const defaultOrigin = env.DEFAULT_ORIGIN || env.TARGET_ORIGIN;
    if (!defaultOrigin) {
      return new Response('Missing DEFAULT_ORIGIN', { status: 500 });
    }

    const appOrigins = {
      aichat: env.APP_AICHAT_ORIGIN,
      connect: env.APP_CONNECT_ORIGIN,
      photos: env.APP_PHOTOS_ORIGIN
    };

    const url = new URL(request.url);
    let targetOrigin = defaultOrigin;

    const jsonResponse = (payload, status = 200) => {
      return new Response(JSON.stringify(payload), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Publish-Token',
        }
      });
    };

    // Verify an X-Publish-Token minted by api-worker's /api/html/publish-token
    // (HS256 JWT, mirrors html-publish-token.js signToken).
    const verifyPublishToken = async (token, secret) => {
      try {
        const [headerB64, payloadB64, sigB64] = String(token || '').split('.');
        if (!headerB64 || !payloadB64 || !sigB64) return null;
        const data = `${headerB64}.${payloadB64}`;
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        const b64ToBytes = (s) => {
          const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4));
          const out = new Uint8Array(b.length);
          for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
          return out;
        };
        const ok = await crypto.subtle.verify('HMAC', key, b64ToBytes(sigB64), new TextEncoder().encode(data));
        if (!ok) return null;
        const claims = JSON.parse(new TextDecoder().decode(b64ToBytes(payloadB64)));
        if (!claims || (claims.exp && Math.floor(Date.now() / 1000) > Number(claims.exp))) return null;
        return claims;
      } catch {
        return null;
      }
    };

    if (url.pathname === '/__html/publish') {
      if (request.method === 'OPTIONS') {
        return jsonResponse({ ok: true });
      }
      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
      }
      if (!env.HTML_PAGES) {
        return jsonResponse({ ok: false, error: 'HTML_PAGES binding missing' }, 500);
      }
      if (!env.HTML_PUBLISH_SECRET) {
        return jsonResponse({ ok: false, error: 'HTML_PUBLISH_SECRET not configured' }, 500);
      }

      let payload = null;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
      }

      const claims = await verifyPublishToken(request.headers.get('X-Publish-Token'), env.HTML_PUBLISH_SECRET);
      if (!claims) {
        return jsonResponse({ ok: false, error: 'Invalid or missing publish token' }, 401);
      }
      const claimHost = String(claims.hostname || '').trim().toLowerCase();
      const bodyHost = String(payload?.hostname || '').trim().toLowerCase();
      if (!claimHost || claimHost !== bodyHost) {
        return jsonResponse({ ok: false, error: 'Publish token is not scoped to this hostname' }, 403);
      }

      const hostname = String(payload?.hostname || '').trim().toLowerCase();
      const html = String(payload?.html || '');
      const overwrite = Boolean(payload?.overwrite);
      if (!hostname || !html) {
        return jsonResponse({ ok: false, error: 'hostname and html are required' }, 400);
      }

      const key = `html:${hostname}`;
      const existing = await env.HTML_PAGES.get(key);
      if (existing && !overwrite) {
        return jsonResponse(
          { ok: false, error: 'Content already exists', exists: true, hostname },
          409,
        );
      }

      // Get graphId/nodeId from payload, or extract from HTML content as fallback
      let graphId = String(payload?.graphId || '');
      let nodeId = String(payload?.nodeId || '');
      if (!graphId) {
        const graphMatch = html.match(/const\s+GRAPH_ID\s*=\s*['"]([^'"]+)['"]/);
        if (graphMatch) graphId = graphMatch[1];
      }
      if (!nodeId) {
        const nodeMatch = html.match(/const\s+NODE_ID\s*=\s*['"]([^'"]+)['"]/);
        if (nodeMatch) nodeId = nodeMatch[1];
      }
      await env.HTML_PAGES.put(key, html, {
        metadata: { graphId, nodeId, publishedAt: new Date().toISOString(), publishedBy: claims.uid || null }
      });
      return jsonResponse({ ok: true, hostname });
    }

    if (url.pathname === '/__html/check') {
      if (request.method === 'OPTIONS') {
        return jsonResponse({ ok: true });
      }
      if (request.method !== 'GET') {
        return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
      }
      if (!env.HTML_PAGES) {
        return jsonResponse({ ok: false, error: 'HTML_PAGES binding missing' }, 500);
      }

      const hostname = String(url.searchParams.get('hostname') || '').trim().toLowerCase();
      if (!hostname) {
        return jsonResponse({ ok: false, error: 'hostname is required' }, 400);
      }

      const { value: existing, metadata } = await env.HTML_PAGES.getWithMetadata(`html:${hostname}`);
      return jsonResponse({ ok: true, hostname, exists: Boolean(existing), metadata: metadata || null });
    }

    // Reading the icon without downloading and parsing the whole page: the caller asks this
    // worker, which already holds the published HTML, and gets back JSON. Must sit ABOVE
    // maybeServeHtmlPage below, which answers every other path with the page itself.
    if (url.pathname === '/__favicon') {
      if (request.method === 'OPTIONS') return jsonResponse({ ok: true });
      if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
      if (!env.HTML_PAGES) return jsonResponse({ ok: false, error: 'HTML_PAGES binding missing' }, 500);

      const host = String(url.searchParams.get('hostname') || url.hostname).trim().toLowerCase();
      if (!/^[a-z0-9.-]{1,253}$/.test(host)) {
        return jsonResponse({ ok: false, error: 'Invalid hostname' }, 400);
      }

      let page = null;
      for (const key of htmlKeysFor(host)) {
        page = await env.HTML_PAGES.get(key);
        if (page) break;
      }
      if (!page) {
        return jsonResponse({ ok: false, error: 'No published page for this hostname', hostname: host }, 404);
      }

      const icons = await extractIcons(page, host);
      const best = pickBestIcon(icons);
      return jsonResponse({
        ok: true,
        hostname: host,
        favicon: best ? best.href : null,
        icons: icons.map(({ px, ...rest }) => rest),
      });
    }

    const maybeServeHtmlPage = async () => {
      if (url.pathname === '/branding.json') return null;
      if (!env.HTML_PAGES) return null;

      for (const key of htmlKeysFor(url.hostname)) {
        const html = await env.HTML_PAGES.get(key);
        if (html) {
          if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_READ_HEADERS });
          }
          return new Response(injectContactFormScript(html), {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
              ...CORS_READ_HEADERS
            }
          });
        }
      }

      return null;
    };

    const htmlResponse = await maybeServeHtmlPage();
    if (htmlResponse) {
      return htmlResponse;
    }

    const buildBrandingResponse = async () => {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const defaults = {
        brand: {
          name: 'Vegvisr',
          logoUrl: '',
          slogan: 'Vegvisr Connect - Early Access'
        },
        meta: {
          title: '',
          faviconUrl: '',
          description: '',
          ogImageUrl: ''
        },
        theme: {
          background: {
            base: '#0b1020',
            radialTop: 'rgba(59,130,246,0.35)',
            radialBottom: 'rgba(139,92,246,0.35)'
          },
          text: {
            primary: '#e5e7eb',
            muted: 'rgba(229,231,235,0.7)',
            headlineGradient: ['#3b82f6', '#8b5cf6']
          },
          card: {
            bg: 'rgba(255,255,255,0.12)',
            border: 'rgba(255,255,255,0.2)'
          },
          button: {
            bgGradient: ['#3b82f6', '#8b5cf6'],
            text: '#ffffff'
          }
        },
        copy: {
          badge: 'Vegvisr Connect - Early Access',
          headline: 'Find your learning path with Vegvisr',
          subheadline: 'Answer a few questions so we can tailor your onboarding experience.',
          emailLabel: 'Enter your email to get a magic link',
          emailPlaceholder: 'Enter your email address',
          cta: 'Send magic link'
        },
        language: {
          default: 'en'
        },
        layout: {
          showLanguageToggle: true
        }
      };

      let config = null;
      if (env.BRAND_CONFIG) {
        const keys = [`brand:${url.hostname}`];
        if (url.hostname.startsWith('www.')) {
          keys.push(`brand:${url.hostname.replace(/^www\./, '')}`);
        }
        for (const key of keys) {
          const raw = await env.BRAND_CONFIG.get(key);
          if (raw) {
            try {
              config = JSON.parse(raw);
              break;
            } catch {
              // ignore invalid config
            }
          }
        }
      }

      const branding = config?.branding || {};
      const merged = {
        brand: {
          ...defaults.brand,
          ...branding.brand,
          logoUrl: branding?.brand?.logoUrl || config?.logoUrl || defaults.brand.logoUrl,
          slogan: branding?.brand?.slogan || config?.slogan || defaults.brand.slogan,
          name: branding?.brand?.name || defaults.brand.name
        },
        meta: {
          ...defaults.meta,
          ...branding.meta
        },
        theme: {
          ...defaults.theme,
          ...branding.theme,
          background: { ...defaults.theme.background, ...branding?.theme?.background },
          text: { ...defaults.theme.text, ...branding?.theme?.text },
          card: { ...defaults.theme.card, ...branding?.theme?.card },
          button: { ...defaults.theme.button, ...branding?.theme?.button }
        },
        copy: {
          ...defaults.copy,
          ...branding.copy
        },
        language: {
          ...defaults.language,
          ...branding.language
        },
        layout: {
          ...defaults.layout,
          ...branding.layout
        },
        // Pass through translations if provided in branding config
        ...(branding.translations ? { translations: branding.translations } : {})
      };

      const response = new Response(JSON.stringify(merged), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'
        }
      });
      await cache.put(cacheKey, response.clone());
      return response;
    };

    if (url.pathname === '/branding.json') {
      return buildBrandingResponse();
    }

    if (env.BRAND_CONFIG) {
      const lookupKeys = [`brand:${url.hostname}`];
      if (url.hostname.startsWith('www.')) {
        lookupKeys.push(`brand:${url.hostname.replace(/^www\./, '')}`);
      }

      for (const key of lookupKeys) {
        const configRaw = await env.BRAND_CONFIG.get(key);
        if (configRaw) {
          try {
            const config = JSON.parse(configRaw);
            const candidate = appOrigins[config?.targetApp] || defaultOrigin;
            if (candidate) {
              targetOrigin = candidate;
            }
            break;
          } catch {
            // ignore config parse errors
          }
        }
      }
    }

    if (targetOrigin === defaultOrigin) {
      const hostParts = url.hostname.split('.');
      const subdomain = hostParts[0];
      if (appOrigins[subdomain]) {
        targetOrigin = appOrigins[subdomain];
      }
    }

    const targetUrl = new URL(targetOrigin);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;

    const headers = new Headers(request.headers);
    headers.set('x-original-hostname', url.hostname);
    headers.set('host', new URL(targetOrigin).host);

    // No page was found for this hostname, so the request falls through to the origin. For a World
    // that origin defaults to its OWN apex, which this same Worker serves — the subrequest is a loop,
    // Cloudflare rejects it and answers 1016 Origin DNS error, and a hostname with no published page
    // becomes indistinguishable from broken DNS. That ambiguity cost an afternoon on 2026-09-24:
    // DNS, token and Worker were all correct and all three were investigated. Say what is true.
    const originHost = new URL(targetOrigin).host;
    const selfReferential = url.hostname === originHost || url.hostname.endsWith('.' + originHost);
    const noPage = (reason) => new Response(
      `No published page for ${url.hostname}.\n\n${reason}\n`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
    if (selfReferential) {
      return noPage(`Nothing is published at html:${url.hostname}, and this Worker also serves ${originHost}, so there is no origin to fall through to. Publish a page for this hostname — do not change DNS, the token or the Worker.`);
    }

    try {
      return await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'follow'
      });
    } catch (error) {
      return noPage(`Nothing is published at html:${url.hostname}, and the origin ${targetOrigin} could not be reached (${error && error.message ? error.message : 'unknown error'}).`);
    }
  }
};
