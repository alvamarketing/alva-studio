(function () {
  'use strict';

  if (window.__NVS_TRACK_LOADED__) return;
  window.__NVS_TRACK_LOADED__ = true;

  var VERSION = '0.3.6-contract-v1';

  function currentScript() {
    if (document.currentScript) return document.currentScript;

    var scripts = document.getElementsByTagName('script');

    for (var i = scripts.length - 1; i >= 0; i--) {
      if ((scripts[i].src || '').indexOf('/nvs.js') !== -1) return scripts[i];
    }

    return null;
  }

  var script = currentScript();

  function attr(name, fallback) {
    if (!script) return fallback;

    var value = script.getAttribute(name);

    if (value === null || value === undefined || value === '') return fallback;

    return value;
  }

  function boolAttr(name, fallback) {
    var value = attr(name, null);

    if (value === null) return fallback;

    value = String(value).toLowerCase();

    return ['1', 'true', 'yes', 'on'].indexOf(value) !== -1;
  }

  function sanitizeKey(value, fallback) {
    value = String(value || '').toLowerCase().trim();
    value = value.replace(/[^a-z0-9_]/g, '_');
    value = value.replace(/_+/g, '_');
    value = value.replace(/^_+|_+$/g, '');

    return value || fallback;
  }

  function sanitizeMetaPixelId(value) {
    value = String(value || '').trim();
    return /^\d{5,32}$/.test(value) ? value : '';
  }

  var defaultApiUrl = (function () {
    if (script && script.src) {
      try {
        var url = new URL(script.src);
        return url.origin + '/nvs-track/ingest.php';
      } catch {}
    }

    return '/nvs-track/ingest.php';
  })();

  var config = {
    version: VERSION,
    apiUrl: attr('data-api-url', defaultApiUrl),
    propertyId: sanitizeKey(attr('data-property-id', 'default'), 'default'),
    cookiePrefix: sanitizeKey(attr('data-cookie-prefix', null), null),
    cookieDomain: attr('data-cookie-domain', ''),
    autoPageView: boolAttr('data-auto-pageview', true),
    metaPixelId: sanitizeMetaPixelId(attr('data-meta-pixel-id', '')),
    metaBrowserPageView: boolAttr('data-meta-browser-pageview', false),
    decorateCheckoutLinks: boolAttr('data-decorate-checkout-links', true),
    trackCheckoutClicks: boolAttr('data-track-checkout-clicks', true),
    debug: boolAttr('data-debug', false),
    sourcePlatform: attr('data-source-platform', 'nvs_js')
  };

  if (!config.cookiePrefix) {
    config.cookiePrefix = config.propertyId === 'default' ? 'nvs' : 'nvs_' + config.propertyId;
  }

  config.metaBrowserPageView = Boolean(config.metaBrowserPageView && config.metaPixelId);

  var cookieNames = {
    uid: config.cookiePrefix + '_uid',
    sid: config.cookiePrefix + '_sid',
    fbp: config.cookiePrefix + '_fbp',
    fbc: config.cookiePrefix + '_fbc',
    fbclid: config.cookiePrefix + '_fbclid',
    gclid: config.cookiePrefix + '_gclid',
    ttclid: config.cookiePrefix + '_ttclid',
    supremeStuid: config.cookiePrefix + '_supreme_stuid'
  };

  var storageKeys = {
    utm: config.cookiePrefix + '_utm',
    firstContext: config.cookiePrefix + '_first_context'
  };

  function log() {
    if (!config.debug || !window.console || !console.log) return;

    var args = Array.prototype.slice.call(arguments);
    args.unshift('[NVS Track]');
    console.log.apply(console, args);
  }

  function randomString(length) {
    length = length || 16;

    var chars = 'abcdef0123456789';
    var output = '';

    if (window.crypto && window.crypto.getRandomValues) {
      var array = new Uint8Array(length);
      window.crypto.getRandomValues(array);

      for (var i = 0; i < array.length; i++) {
        output += chars[array[i] % chars.length];
      }

      return output;
    }

    for (var j = 0; j < length; j++) {
      output += chars[Math.floor(Math.random() * chars.length)];
    }

    return output;
  }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  function getCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];

    for (var i = 0; i < parts.length; i++) {
      var item = parts[i].split('=');
      var key = decodeURIComponent(item.shift());

      if (key === name) {
        return decodeURIComponent(item.join('='));
      }
    }

    return null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    if (!name || !value) return;

    var cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value);
    cookie += '; Path=/';
    cookie += '; Max-Age=' + String(maxAgeSeconds || 31536000);
    cookie += '; SameSite=Lax';

    if (location.protocol === 'https:') cookie += '; Secure';
    if (config.cookieDomain) cookie += '; Domain=' + config.cookieDomain;

    document.cookie = cookie;
  }

  function getQueryParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch {
      return null;
    }
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function getStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  }

  function removeEmpty(obj) {
    var clean = {};

    Object.keys(obj || {}).forEach(function (key) {
      var value = obj[key];

      if (value === null || value === undefined || value === '') return;
      if (Array.isArray(value) && value.length === 0) return;

      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        return;
      }

      clean[key] = value;
    });

    return clean;
  }

  function getOrCreateUid() {
    var uid = getCookie(cookieNames.uid);

    if (!uid) {
      uid = config.cookiePrefix + '_' + randomString(16);
      setCookie(cookieNames.uid, uid, 60 * 60 * 24 * 395);
    }

    return uid;
  }

  function getOrCreateSid() {
    var sid = getCookie(cookieNames.sid);

    if (!sid) {
      sid = config.cookiePrefix + '_sid_' + randomString(16);
    }

    setCookie(cookieNames.sid, sid, 60 * 30);

    return sid;
  }

  function captureClickIds() {
    var fbclid = getQueryParam('fbclid');
    var gclid = getQueryParam('gclid');
    var ttclid = getQueryParam('ttclid');
    var stuid = getQueryParam('stuid');

    if (fbclid) setCookie(cookieNames.fbclid, fbclid, 60 * 60 * 24 * 90);
    if (gclid) setCookie(cookieNames.gclid, gclid, 60 * 60 * 24 * 90);
    if (ttclid) setCookie(cookieNames.ttclid, ttclid, 60 * 60 * 24 * 90);
    if (stuid) setCookie(cookieNames.supremeStuid, stuid, 60 * 60 * 24 * 395);
  }

  function getOrCreateFbp() {
    var metaFbp = config.metaBrowserPageView ? getCookie('_fbp') : null;
    var fbp = metaFbp || getCookie(cookieNames.fbp);

    if (!fbp) {
      fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1000000000);
    }

    if (getCookie(cookieNames.fbp) !== fbp) {
      setCookie(cookieNames.fbp, fbp, 60 * 60 * 24 * 395);
    }

    if (config.metaBrowserPageView && getCookie('_fbp') !== fbp) {
      setCookie('_fbp', fbp, 60 * 60 * 24 * 395);
    }

    return fbp;
  }

  function getOrCreateFbc() {
    var metaFbc = config.metaBrowserPageView ? getCookie('_fbc') : null;
    var fbc = metaFbc || getCookie(cookieNames.fbc);
    var currentFbclid = getQueryParam('fbclid');
    var storedFbclid = getCookie(cookieNames.fbclid);
    var fbclid = currentFbclid || storedFbclid;
    var fbcParts = fbc ? String(fbc).split('.') : [];
    var fbcClickId = fbcParts.length >= 4 ? fbcParts.slice(3).join('.') : '';

    if (fbclid && (!fbc || (currentFbclid && fbcClickId !== currentFbclid))) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
    }

    if (fbc && getCookie(cookieNames.fbc) !== fbc) {
      setCookie(cookieNames.fbc, fbc, 60 * 60 * 24 * 90);
    }

    if (config.metaBrowserPageView && fbc && getCookie('_fbc') !== fbc) {
      setCookie('_fbc', fbc, 60 * 60 * 24 * 90);
    }

    return fbc;
  }

  function captureUtm() {
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
    var found = {};
    var hasNew = false;

    keys.forEach(function (key) {
      var value = getQueryParam(key);

      if (value) {
        found[key] = value;
        hasNew = true;
      }
    });

    if (hasNew) {
      found.captured_at = new Date().toISOString();
      found.page_url = window.location.href;
      setStorage(storageKeys.utm, JSON.stringify(found));
      return found;
    }

    return safeJsonParse(getStorage(storageKeys.utm), {});
  }

  function captureFirstContext() {
    var existing = safeJsonParse(getStorage(storageKeys.firstContext), null);

    if (existing) return existing;

    var context = {
      property_id: config.propertyId,
      cookie_prefix: config.cookiePrefix,
      landing_url: window.location.href,
      referrer: document.referrer || null,
      captured_at: new Date().toISOString()
    };

    setStorage(storageKeys.firstContext, JSON.stringify(context));

    return context;
  }

  captureClickIds();

  var nvsUid = getOrCreateUid();
  var nvsSid = getOrCreateSid();
  var utm = captureUtm();
  var firstContext = captureFirstContext();

  function providerIds() {
    return removeEmpty({
      fbp: getOrCreateFbp(),
      fbc: getOrCreateFbc(),
      fbclid: getQueryParam('fbclid') || getCookie(cookieNames.fbclid),
      gclid: getQueryParam('gclid') || getCookie(cookieNames.gclid),
      ttclid: getQueryParam('ttclid') || getCookie(cookieNames.ttclid),
      supremeStuid: getQueryParam('stuid') || getCookie(cookieNames.supremeStuid)
    });
  }

  function getIds() {
    nvsUid = getOrCreateUid();
    nvsSid = getOrCreateSid();

    return {
      property_id: config.propertyId,
      cookie_prefix: config.cookiePrefix,
      nvs_uid: nvsUid,
      nvs_sid: nvsSid
    };
  }

  function baseContext() {
    return removeEmpty({
      property_id: config.propertyId,
      cookie_prefix: config.cookiePrefix,
      nvs_uid: nvsUid,
      nvs_sid: nvsSid,
      page_url: window.location.href,
      landing_url: firstContext.landing_url || window.location.href,
      referrer: document.referrer || firstContext.referrer || null,
      page_title: document.title || null,
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      screen_width: window.screen ? window.screen.width : null,
      screen_height: window.screen ? window.screen.height : null,
      viewport_width: window.innerWidth || null,
      viewport_height: window.innerHeight || null,
      source_domain: window.location.hostname
    });
  }

  function metaEventName(eventName) {
    var map = {
      page_view: 'PageView',
      view_content: 'ViewContent',
      view_item: 'ViewContent',
      initiate_checkout: 'InitiateCheckout',
      lead: 'Lead',
      complete_registration: 'CompleteRegistration',
      add_to_cart: 'AddToCart',
      purchase: 'Purchase'
    };

    return map[eventName] || eventName;
  }

  function eventId(eventName) {
    return [
      'nvs_browser',
      config.propertyId,
      eventName,
      Date.now(),
      randomString(10)
    ].join('_');
  }

  function ensureMetaPixelQueue() {
    if (typeof window.fbq === 'function') {
      window.fbq.disablePushState = true;
      return window.fbq;
    }

    var fbq = function () {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
      } else {
        fbq.queue.push(arguments);
      }
    };

    window.fbq = fbq;

    if (!window._fbq) {
      window._fbq = fbq;
    }

    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    fbq.disablePushState = true;

    var loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://connect.facebook.net/en_US/fbevents.js';

    var firstScript = document.getElementsByTagName('script')[0];

    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(loader, firstScript);
    } else if (document.head) {
      document.head.appendChild(loader);
    } else {
      document.documentElement.appendChild(loader);
    }

    return fbq;
  }

  function metaPixelIsInitialized(fbq, pixelId) {
    var initialized = window.__NVS_META_PIXEL_INIT_IDS__ || {};

    if (initialized[pixelId]) return true;
    if (fbq._i && fbq._i[pixelId]) return true;

    if (typeof fbq.getState === 'function') {
      try {
        var state = fbq.getState();
        var pixels = state && Array.isArray(state.pixels) ? state.pixels : [];

        for (var i = 0; i < pixels.length; i++) {
          var statePixelId = pixels[i] && (pixels[i].id || pixels[i].pixelID || pixels[i]);
          if (String(statePixelId || '') === pixelId) return true;
        }
      } catch {}
    }

    var queue = Array.isArray(fbq.queue) ? fbq.queue : [];

    for (var j = 0; j < queue.length; j++) {
      var queued = queue[j];
      if (queued && queued[0] === 'init' && String(queued[1] || '') === pixelId) return true;
    }

    return false;
  }

  function ensureMetaPixel() {
    if (!config.metaBrowserPageView) return null;

    var fbq = ensureMetaPixelQueue();
    var initialized = window.__NVS_META_PIXEL_INIT_IDS__ || {};

    if (!metaPixelIsInitialized(fbq, config.metaPixelId)) {
      fbq('init', config.metaPixelId);
    }

    initialized[config.metaPixelId] = true;
    window.__NVS_META_PIXEL_INIT_IDS__ = initialized;

    return fbq;
  }

  function sendMetaBrowserPageView(sharedEventId) {
    var fbq = ensureMetaPixel();

    if (!fbq) return false;

    fbq('trackSingle', config.metaPixelId, 'PageView', {}, { eventID: sharedEventId });
    log('meta browser pageview', {
      pixel_id: config.metaPixelId,
      event_id: sharedEventId
    });

    return true;
  }

  function buildPayload(eventName, params, options) {
    options = options || {};
    params = params || {};

    nvsUid = getOrCreateUid();
    nvsSid = getOrCreateSid();
    utm = captureUtm();

    return removeEmpty({
      event_name: eventName,
      meta_event_name: metaEventName(eventName),
      event_id: options.event_id || eventId(eventName),
      event_time: nowSeconds(),
      property_id: config.propertyId,
      cookie_prefix: config.cookiePrefix,
      source_platform: config.sourcePlatform,
      page_url: window.location.href,
      referrer: document.referrer || null,
      nvs_uid: nvsUid,
      nvs_sid: nvsSid,
      provider_ids: providerIds(),
      utm: utm,
      params: params,
      user: options.user || {},
      context: baseContext()
    });
  }

  function sendPayload(payload) {
    log('sending', payload);

    return fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8'
      },
      credentials: 'omit',
      keepalive: true,
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().catch(function () {
          return {
            ok: false,
            error: 'invalid_json_response',
            http_status: response.status
          };
        });
      })
      .then(function (data) {
        log('response', data);
        return data;
      })
      .catch(function (error) {
        log('error', error);

        return {
          ok: false,
          error: 'fetch_failed',
          message: error && error.message ? error.message : String(error)
        };
      });
  }

  function track(eventName, params, options) {
    eventName = sanitizeKey(eventName || 'page_view', 'page_view');

    var payload = buildPayload(eventName, params || {}, options || {});

    return sendPayload(payload);
  }

  function isCheckoutLink(href) {
    if (!href) return false;

    try {
      var url = new URL(href, window.location.href);
      var host = url.hostname.toLowerCase();
      var path = url.pathname.toLowerCase();

      if (host.indexOf('nvspay.com') !== -1 && path.indexOf('/checkout') !== -1) return true;
      if (path.indexOf('/checkout') !== -1) return true;

      return false;
    } catch {
      return false;
    }
  }

  function trackingParams() {
    var ids = getIds();
    var providers = providerIds();
    var params = {};

    params.nvs_uid = ids.nvs_uid;
    params.nvs_sid = ids.nvs_sid;
    params.nvs_property_id = config.propertyId;

    if (providers.fbp) params.fbp = providers.fbp;
    if (providers.fbc) params.fbc = providers.fbc;
    if (providers.fbclid) params.fbclid = providers.fbclid;
    if (providers.gclid) params.gclid = providers.gclid;
    if (providers.ttclid) params.ttclid = providers.ttclid;
    if (providers.supremeStuid) params.stuid = providers.supremeStuid;

    Object.keys(utm || {}).forEach(function (key) {
      if (key.indexOf('utm_') === 0 && utm[key]) {
        params[key] = utm[key];
      }
    });

    return removeEmpty(params);
  }

  function appendParamsToUrl(href) {
    try {
      var url = new URL(href, window.location.href);
      var params = trackingParams();

      var overwriteKeys = [
        'nvs_uid',
        'nvs_sid',
        'nvs_property_id',
        'fbp',
        'fbc',
        'fbclid',
        'gclid',
        'ttclid',
        'stuid',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'utm_id'
      ];

      overwriteKeys.forEach(function (key) {
        if (params[key]) {
          url.searchParams.set(key, params[key]);
        }
      });

      Object.keys(params).forEach(function (key) {
        if (!url.searchParams.has(key)) {
          url.searchParams.set(key, params[key]);
        }
      });

      return url.toString();
    } catch {
      return href;
    }
  }

  function decorateCheckoutLinks(root) {
    if (!config.decorateCheckoutLinks) return;

    root = root || document;

    var links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];

    Array.prototype.forEach.call(links, function (link) {
      var href = link.getAttribute('href');

      if (!isCheckoutLink(href)) return;

      link.setAttribute('href', appendParamsToUrl(href));
      link.setAttribute('data-nvs-decorated', 'true');
      link.setAttribute('data-nvs-property-id', config.propertyId);
    });
  }

  function onCheckoutClick(event) {
    var target = event.target;

    while (target && target !== document) {
      if (target.tagName && String(target.tagName).toLowerCase() === 'a') break;
      target = target.parentNode;
    }

    if (!target || !target.getAttribute) return;

    var href = target.getAttribute('href');

    if (!isCheckoutLink(href)) return;

    var decoratedUrl = appendParamsToUrl(href);
    target.setAttribute('href', decoratedUrl);

    if (config.trackCheckoutClicks) {
      track('initiate_checkout', {
        checkout_url: decoratedUrl,
        link_text: (target.innerText || target.textContent || '').trim().slice(0, 190)
      });
    }
  }

  var didAutoPageView = false;

  function autoPageView() {
    if (!config.autoPageView || didAutoPageView) return;

    didAutoPageView = true;

    var sharedEventId = eventId('page_view');

    if (config.metaBrowserPageView) {
      providerIds();
      sendMetaBrowserPageView(sharedEventId);
    }

    track('page_view', {
      url: window.location.href,
      title: document.title || null
    }, {
      event_id: sharedEventId
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      setTimeout(fn, 0);
    }
  }

  window.NVS = {
    version: VERSION,
    config: config,
    track: track,
    pageView: function (params, options) {
      return track('page_view', params || {}, options || {});
    },
    viewContent: function (params, options) {
      return track('view_content', params || {}, options || {});
    },
    initiateCheckout: function (params, options) {
      return track('initiate_checkout', params || {}, options || {});
    },
    lead: function (params, options) {
      return track('lead', params || {}, options || {});
    },
    purchase: function (params, options) {
      return track('purchase', params || {}, options || {});
    },
    getIds: getIds,
    getProviderIds: providerIds,
    getUtm: function () {
      return captureUtm();
    },
    getTrackingParams: trackingParams,
    appendParamsToUrl: appendParamsToUrl,
    decorateCheckoutLinks: decorateCheckoutLinks,
    getConfig: function () {
      return config;
    }
  };

  document.addEventListener('click', onCheckoutClick, true);

  if (config.metaBrowserPageView) {
    autoPageView();
  }

  ready(function () {
    decorateCheckoutLinks(document);
    autoPageView();

    log('loaded', {
      version: VERSION,
      property_id: config.propertyId,
      cookie_prefix: config.cookiePrefix,
      api_url: config.apiUrl,
      cookie_names: cookieNames
    });
  });
})();
