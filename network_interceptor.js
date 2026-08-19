/**
 * Coursera Video Completion Enforcer — MAIN Execution World Network Interceptor
 * Runs at document_start to monkey-patch fetch/XHR before Coursera scripts load.
 *
 * Architecture: Capture + Replay
 *  1. Captures all outgoing POST/PUT/PATCH requests matching Coursera's video progress patterns
 *  2. On VIDEO_ENDED signal, replays captured requests with forged 100% completion payloads
 *  3. Fires direct API calls to Coursera's completion endpoints as a belt-and-suspenders fallback
 */
(function () {
  if (window.__COURSERA_NET_INTERCEPTOR_ACTIVE__) return;
  window.__COURSERA_NET_INTERCEPTOR_ACTIVE__ = true;

  /* ==========================
   *  State
   * ========================== */
  var batches = [];
  var others = [];
  var cidCache = {};

  /* ==========================
   *  Native References
   * ========================== */
  var realFetch = window.fetch.bind(window);
  var realOpen = XMLHttpRequest.prototype.open;
  var realSend = XMLHttpRequest.prototype.send;
  var realSetReqHeader = XMLHttpRequest.prototype.setRequestHeader;

  /* ==========================
   *  Logging
   * ========================== */
  function log(...args) {
    console.log(
      '%c[Coursera Enforcer]%c',
      'background: #059669; color: white; border-radius: 3px; padding: 2px 5px; font-weight: bold;',
      '',
      ...args
    );
  }

  /* ==========================
   *  Helpers
   * ========================== */
  function getCSRF() {
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      if (/csrf/i.test(parts[i].slice(0, eq).trim()))
        return decodeURIComponent(parts[i].slice(eq + 1).trim());
    }
    return null;
  }

  function getUserId() {
    for (var i = 0; i < batches.length; i++) {
      try {
        var evts = JSON.parse(batches[i].body).events || [];
        for (var j = 0; j < evts.length; j++) {
          if (evts[j].userId) return String(evts[j].userId);
          if (evts[j].value && evts[j].value.user_id)
            return String(evts[j].value.user_id);
        }
      } catch (x) {}
    }
    for (var k = 0; k < others.length; k++) {
      try {
        var b = JSON.parse(others[k].body || '{}');
        if (b.userId) return String(b.userId);
      } catch (x) {}
      var m = (others[k].body || '').match(/"userId"\s*:\s*(\d+)/);
      if (m) return m[1];
    }
    try {
      var s = JSON.stringify(window.__PRELOADED_STATE__ || {});
      var match = s.match(/"userId"\s*:\s*"?(\d+)"?/);
      if (match) return match[1];
    } catch (x) {}
    return '';
  }

  async function getCourseId(slug) {
    if (cidCache[slug]) return cidCache[slug];
    try {
      var r = await realFetch(
        '/api/courses.v1?q=slug&slug=' + encodeURIComponent(slug) + '&fields=id',
        { credentials: 'include' }
      );
      var d = await r.json();
      var id = (d && d.elements && d.elements[0] && d.elements[0].id) || '';
      if (id) cidCache[slug] = id;
      return id;
    } catch (x) {
      return '';
    }
  }

  function makeGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function patchBody(body) {
    if (!body) return body;
    try {
      var P = {
        watchedUpTo: 999999,
        watchedUpto: 999999,
        videoPosition: 999999,
        currentTime: 999999,
        position: 999999,
        percentWatched: 1,
        percentageWatched: 100,
        video_position: 999999,
        video_percent: 100,
        watched_seconds: 999999,
        percent_watched: 100,
        videoProgress: 1,
        progress: 1,
        isCompleted: true,
        is_completed: true,
        completed: true,
        watched: true
      };
      var obj = JSON.parse(body);
      (function deep(o) {
        if (!o || typeof o !== 'object') return;
        Object.keys(P).forEach(function (k) {
          if (k in o) o[k] = P[k];
        });
        Object.values(o).forEach(deep);
      })(obj);
      return JSON.stringify(obj);
    } catch (x) {
      return body;
    }
  }

  function upsert(arr, key, val) {
    var i = arr.findIndex(function (x) {
      return x.url === key;
    });
    if (i !== -1) arr.splice(i, 1);
    arr.push(val);
  }

  /* ==========================
   *  1. Capture — Request Interception
   * ========================== */
  function capture(url, method, body, meta) {
    if (!url || method === 'GET') return;
    var u = url.toLowerCase();
    if (/\.(css|png|woff|ttf|gif|jpg|webp|svg|ico|map)/.test(u)) return;
    if (/amazonaws|cloudfront|gstatic|pendo|sentry|analytics|log\.coursera/.test(u)) return;

    var batchPath = 'eventing' + '/' + 'info' + 'batch';
    if (u.indexOf(batchPath) !== -1) {
      try {
        var parsed = JSON.parse(body);
        var evts = Array.isArray(parsed.events) ? parsed.events : [];
        if (
          evts.some(function (e) {
            return e.key && /video|heartbeat/.test(e.key);
          })
        ) {
          upsert(
            batches,
            url,
            Object.assign({ url: url, method: method, body: body, parsed: parsed }, meta)
          );
          log('Captured batch heartbeat — total:', batches.length + others.length);
        }
      } catch (x) {}
      return;
    }

    var isProgressUrl = /videoevents|lectureview|ondemandlecture|trackeditem|heartbeat|completion|videoprogress/.test(u);
    var bl = (body || '').toLowerCase();
    var isProgressBody = /videoposition|watchedupto|percentwatched|viewedupto|iscompleted|video_position|video_percent|percent_watched/.test(bl);

    if (isProgressUrl || isProgressBody) {
      upsert(
        others,
        url,
        Object.assign({ url: url, method: method, body: body }, meta)
      );
      log('Captured progress request — total:', batches.length + others.length);
    }
  }

  /* ==========================
   *  2. fetch() Monkey-Patch
   * ========================== */
  window.fetch = function (input, opts) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = ((opts && opts.method) || 'GET').toUpperCase();
      var body = '';
      try {
        body = opts && opts.body ? String(opts.body) : '';
      } catch (x) {}
      capture(url, method, body, { kind: 'fetch', opts: safeCopy(opts || {}) });
    } catch (x) {}
    return realFetch(input, opts);
  };

  function safeCopy(o) {
    try {
      return JSON.parse(JSON.stringify(o));
    } catch (x) {
      return Object.assign({}, o);
    }
  }

  /* ==========================
   *  3. XMLHttpRequest Monkey-Patch
   * ========================== */
  XMLHttpRequest.prototype.open = function (m, u) {
    this._courseraUrl = u;
    this._courseraMethod = (m || 'GET').toUpperCase();
    this._courseraHeaders = {};
    return realOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this._courseraHeaders) this._courseraHeaders[k] = v;
    return realSetReqHeader.call(this, k, v);
  };

  XMLHttpRequest.prototype.send = function (body) {
    capture(this._courseraUrl || '', this._courseraMethod || 'GET', body ? String(body) : '', {
      kind: 'xhr',
      headers: Object.assign({}, this._courseraHeaders)
    });
    return realSend.call(this, body);
  };

  /* ==========================
   *  4. Replay Functions
   * ========================== */
  async function replayBatches() {
    if (!batches.length) return;
    var tpl = batches[batches.length - 1];
    var parsed;
    try {
      parsed = JSON.parse(tpl.body);
    } catch (x) {
      return;
    }
    var evts = Array.isArray(parsed.events) ? parsed.events : [];
    var hb =
      evts.find(function (e) {
        return e.key === 'open_course.video.heartbeat';
      }) ||
      evts.find(function (e) {
        return e.key && e.key.indexOf('video') !== -1;
      }) ||
      evts[0];
    if (!hb) return;

    var now = Date.now();
    var completionEvts = [
      Object.assign({}, hb, {
        key: 'open_course.video.heartbeat',
        clientTimestamp: now,
        guid: makeGuid(),
        value: Object.assign({}, hb.value || {}, {
          video_position: 999999,
          video_percent: 100,
          watched_seconds: 999999,
          percent_watched: 100,
          is_completed: true
        })
      }),
      Object.assign({}, hb, {
        key: 'open_course.video.complete',
        clientTimestamp: now + 100,
        guid: makeGuid(),
        value: Object.assign({}, hb.value || {}, {
          video_position: 999999,
          video_percent: 100,
          is_completed: true
        })
      })
    ];

    var init = Object.assign({}, tpl.opts || {}, {
      method: 'POST',
      body: JSON.stringify(Object.assign({}, parsed, { events: completionEvts }))
    });

    var csrf = getCSRF();
    if (csrf) {
      init.headers = init.headers || {};
      init.headers['CSRF3-Token'] = csrf;
      init.headers['X-CSRF3-Token'] = csrf;
    }

    try {
      var r = await realFetch(tpl.url, init);
      log('Batch replay →', r.status, r.statusText);
    } catch (x) {
      log('Batch replay failed:', x.message);
    }
  }

  async function replayOthers() {
    for (var i = 0; i < others.length; i++) {
      var req = others[i];
      try {
        var pb = patchBody(req.body);
        if (req.kind === 'fetch') {
          await realFetch(
            req.url,
            Object.assign({}, req.opts || {}, { method: req.method, body: pb })
          );
        } else {
          await new Promise(function (res) {
            var x = new XMLHttpRequest();
            realOpen.call(x, req.method, req.url, true);
            Object.entries(req.headers || {}).forEach(function (pair) {
              realSetReqHeader.call(x, pair[0], pair[1]);
            });
            if (pb && !(req.headers || {})['Content-Type'])
              realSetReqHeader.call(x, 'Content-Type', 'application/json');
            x.onloadend = res;
            x.onerror = res;
            realSend.call(x, pb);
          });
        }
        log('Others replay OK —', req.url);
      } catch (x) {
        log('Others replay failed:', x.message);
      }
    }
  }

  async function directAPI() {
    var m = location.pathname.match(
      /\/learn\/([^/]+)\/(?:lecture|supplement|exam|quiz|ungradedLab)\/([^/?#]+)/
    );
    if (!m) return;
    var slug = m[1],
      itemId = m[2],
      csrf = getCSRF();
    if (!csrf) return;

    var userId = getUserId();
    var courseId = await getCourseId(slug);

    var h = {
      'Content-Type': 'application/json;charset=UTF-8',
      'CSRF3-Token': csrf,
      'X-CSRF3-Token': csrf
    };

    if (userId) {
      await realFetch(
        '/api/opencourse.v1/user/' + userId + '/course/' + slug + '/item/' + itemId + '/videoEvents',
        {
          method: 'POST',
          headers: h,
          credentials: 'include',
          body: JSON.stringify({ type: 'ViewedUpto', videoPosition: 999999 })
        }
      ).catch(function () {});
      log('Direct API — videoEvents sent for user', userId);
    }

    if (courseId) {
      await Promise.allSettled([
        realFetch('/api/onDemandLectureViews.v1', {
          method: 'POST',
          headers: h,
          credentials: 'include',
          body: JSON.stringify({
            courseId: courseId,
            itemId: itemId,
            isCompleted: true,
            watchedUpTo: 999999,
            videoProgress: 1,
            percentWatched: 1
          })
        }),
        realFetch('/api/onDemandLearnerMaterials.v1', {
          method: 'POST',
          headers: h,
          credentials: 'include',
          body: JSON.stringify({
            courseId: courseId,
            itemId: itemId,
            isCompleted: true
          })
        })
      ]);
      log('Direct API — LectureViews + LearnerMaterials sent for course', courseId);
    }
  }

  async function fireCompletionReplay() {
    log('Firing completion replay — batches:', batches.length, 'others:', others.length);
    await Promise.allSettled([replayBatches(), replayOthers(), directAPI()]);
    log('All completion replays settled');
  }

  /* ==========================
   *  5. Message Listener
   * ========================== */
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'COURSERA_SPEED_MAIN_WORLD') return;

    if (event.data.type === 'TRIGGER_COMPLETION') {
      log('TRIGGER_COMPLETION received — replaying all captured requests');
      fireCompletionReplay();
    }
  });

  log('Network interceptor active — capture+replay architecture loaded at document_start.');
})();
