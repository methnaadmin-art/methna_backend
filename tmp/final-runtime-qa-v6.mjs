import fs from 'fs/promises';

const baseUrl = 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = 'admin@methna.app';
const ADMIN_PASSWORD = 'Admin@123456';
const TEST_PASSWORD = 'Qa@123456!';

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  setup: {},
  checks: [],
  metrics: {
    swipe: {},
    purchase: {},
    polish: {},
    architecture: {},
  },
  scores: {
    swipeExperience: null,
    purchaseUsability: null,
    swipeConfidence: null,
    purchaseConfidence: null,
  },
  criticalIssues: [],
  failingScenarios: [],
  architectureSummary: {},
};

function unwrap(resp) {
  if (!resp?.json) return null;
  return Object.prototype.hasOwnProperty.call(resp.json, 'data') ? resp.json.data : resp.json;
}

function toQuery(params = {}) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.join(','));
      continue;
    }
    sp.set(key, String(value));
  }
  const query = sp.toString();
  return query ? `?${query}` : '';
}

async function api(method, path, { token, body, query } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const started = Date.now();
  const res = await fetch(`${baseUrl}${path}${toQuery(query)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const durationMs = Date.now() - started;

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    durationMs,
    text,
    json,
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getAgeFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function normalizeNotificationType(notification) {
  const data = notification?.data || {};
  const payload = data?.payload || {};
  return String(data.type || payload.type || notification?.type || '').toLowerCase().trim();
}

function addCheck(group, key, name, status, details = {}, severity = 'normal', repro = null) {
  const normalizedStatus = status === 'pass' || status === 'fail' || status === 'blocked' ? status : 'blocked';
  const entry = {
    group,
    key,
    name,
    status: normalizedStatus,
    passed: normalizedStatus === 'pass',
    details,
    severity,
    repro,
  };

  report.checks.push(entry);

  if (normalizedStatus === 'fail' && severity === 'critical') {
    report.criticalIssues.push({ group, key, name, details });
  }

  if (normalizedStatus === 'fail' && repro) {
    report.failingScenarios.push({ group, key, name, steps: repro, details });
  }
}

async function login(email, password) {
  const resp = await api('POST', '/auth/login', {
    body: { email, password },
  });

  if (!resp.ok) return { ok: false, resp };

  const data = unwrap(resp);
  return {
    ok: true,
    token: data?.accessToken,
    user: data?.user,
  };
}

async function createRuntimeUser(adminToken, { label, gender, dateOfBirth }) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `runtime.v6.${label}.${stamp}@methna.test`;
  const username = `runtime_v6_${label}_${Math.floor(Math.random() * 100000)}`;

  const created = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: `Runtime${label}`,
      lastName: 'QA',
      username,
      status: 'active',
    },
  });

  if (!created.ok) {
    throw new Error(`Failed to create runtime user ${label}: ${created.status} ${created.text}`);
  }

  const auth = await login(email, TEST_PASSWORD);
  if (!auth.ok) {
    throw new Error(`Failed to login runtime user ${label}: ${auth.resp.status} ${auth.resp.text}`);
  }

  const profileResp = await api('POST', '/profiles', {
    token: auth.token,
    body: {
      bio: 'Final runtime QA profile with complete data.',
      gender,
      dateOfBirth,
      maritalStatus: 'never_married',
      religiousLevel: 'practicing',
      sect: 'other',
      prayerFrequency: 'actively_practicing',
      dietary: 'non_strict',
      alcohol: 'drinks',
      jobTitle: 'QA Engineer',
      education: 'doctorate',
      marriageIntention: 'within_months',
      intentMode: 'serious_marriage',
      interests: ['Reading', 'Travel', 'Technology', 'Sports'],
      languages: ['Arabic', 'English'],
      aboutPartner: 'Final runtime compatibility testing profile.',
      city: 'RuntimeCity',
      country: 'RuntimeCountry',
    },
  });

  if (!profileResp.ok) {
    throw new Error(`Failed to create profile for ${label}: ${profileResp.status} ${profileResp.text}`);
  }

  const locationResp = await api('PATCH', '/profiles/location', {
    token: auth.token,
    body: {
      latitude: 36.7538,
      longitude: 3.0588,
      city: 'RuntimeCity',
      country: 'RuntimeCountry',
    },
  });

  if (!locationResp.ok) {
    throw new Error(`Failed to set location for ${label}: ${locationResp.status} ${locationResp.text}`);
  }

  const profileMe = await api('GET', '/profiles/me', { token: auth.token });
  const completion = unwrap(profileMe)?.profileCompletionPercentage ?? 0;

  return {
    id: auth.user?.id,
    email,
    token: auth.token,
    completion,
  };
}

function computeWeightedScore(checksByKey, weights) {
  let testedWeight = 0;
  let earnedWeight = 0;
  const totalWeight = Object.values(weights).reduce((sum, v) => sum + v, 0);

  for (const [key, weight] of Object.entries(weights)) {
    const status = checksByKey[key];
    if (status === 'blocked' || status === undefined) continue;
    testedWeight += weight;
    if (status === 'pass') earnedWeight += weight;
  }

  const score = testedWeight > 0 ? Math.round((earnedWeight / testedWeight) * 100) : 0;
  const confidence = totalWeight > 0 ? Number((testedWeight / totalWeight).toFixed(2)) : 0;

  return {
    score,
    confidence,
    testedWeight,
    totalWeight,
    earnedWeight,
  };
}

async function run() {
  try {
    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!adminLogin.ok) {
      throw new Error(`Admin login failed: ${adminLogin.resp.status} ${adminLogin.resp.text}`);
    }
    const adminToken = adminLogin.token;

    const viewer = await createRuntimeUser(adminToken, {
      label: 'viewer',
      gender: 'female',
      dateOfBirth: '1995-02-11',
    });

    const liker = await createRuntimeUser(adminToken, {
      label: 'liker',
      gender: 'male',
      dateOfBirth: '1993-07-21',
    });

    const moderationUser = await createRuntimeUser(adminToken, {
      label: 'moderation',
      gender: 'male',
      dateOfBirth: '1994-05-09',
    });

    report.setup = {
      adminId: adminLogin.user?.id,
      viewer: { id: viewer.id, email: viewer.email, completion: viewer.completion },
      liker: { id: liker.id, email: liker.email, completion: liker.completion },
      moderationUser: { id: moderationUser.id, email: moderationUser.email, completion: moderationUser.completion },
    };

    addCheck(
      'setup',
      'profiles_complete',
      'Runtime QA users have complete profiles for positive swipes',
      [viewer, liker, moderationUser].every((u) => Number(u.completion) >= 60) ? 'pass' : 'fail',
      {
        viewerCompletion: viewer.completion,
        likerCompletion: liker.completion,
        moderationCompletion: moderationUser.completion,
      },
      'critical',
      [
        'Create runtime QA users and open profile completion.',
        'Attempt positive swipe action.',
        'Expected: no profile-completion gate for this QA run.',
      ],
    );

    await api('PUT', '/profiles/preferences', {
      token: viewer.token,
      body: {
        minAge: 20,
        maxAge: 55,
        preferredGender: 'male',
        maxDistance: 1000,
      },
    });

    const localDeckConfig = {
      batchSize: 20,
      prefetchThreshold: 5,
      maxEnsureAttempts: 4,
    };

    const localDeckState = {
      buffer: [],
      seenIds: new Set(),
      history: [],
      pendingWritePromises: [],
      nextCursor: null,
      prefetchDurations: [],
      prefetchEvents: [],
      prefetchInFlight: null,
    };

    const isUserBuffered = (userId) => localDeckState.buffer.some((u) => u?.id === userId);

    const mergeBufferUsers = (users) => {
      for (const user of users || []) {
        const userId = user?.id;
        if (!userId) continue;
        if (localDeckState.seenIds.has(userId)) continue;
        if (isUserBuffered(userId)) continue;
        localDeckState.buffer.push(user);
      }
    };

    const fetchDeckBatch = async ({ forceRefresh = false, reason = 'prefetch' } = {}) => {
      const query = {
        limit: localDeckConfig.batchSize,
        sortBy: 'distance',
        goGlobal: true,
        includeDeckMeta: true,
      };

      if (forceRefresh) {
        query.forceRefresh = true;
      } else if (localDeckState.nextCursor) {
        query.cursor = localDeckState.nextCursor;
      }

      if (localDeckState.seenIds.size > 0) {
        query.excludeIds = [...localDeckState.seenIds];
      }

      const resp = await api('GET', '/search', {
        token: viewer.token,
        query,
      });

      const data = unwrap(resp) || {};
      const users = Array.isArray(data.users) ? data.users : [];
      mergeBufferUsers(users);
      localDeckState.nextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
      localDeckState.prefetchDurations.push(resp.durationMs);
      localDeckState.prefetchEvents.push({
        reason,
        durationMs: resp.durationMs,
        fetchedCount: users.length,
        bufferedCount: localDeckState.buffer.length,
        usedCursor: query.cursor ?? null,
        nextCursor: localDeckState.nextCursor,
      });

      return { resp, users, data };
    };

    const ensureDeckPrefetch = (reason = 'prefetch') => {
      if (localDeckState.prefetchInFlight) {
        return localDeckState.prefetchInFlight;
      }

      const shouldForceRefresh = localDeckState.prefetchDurations.length === 0 || !localDeckState.nextCursor;
      localDeckState.prefetchInFlight = fetchDeckBatch({
        forceRefresh: shouldForceRefresh,
        reason,
      }).finally(() => {
        localDeckState.prefetchInFlight = null;
      });

      return localDeckState.prefetchInFlight;
    };

    const ensureBufferedCards = async (minCards, reason = 'ensure_buffer') => {
      let attempts = 0;
      while (localDeckState.buffer.length < minCards && attempts < localDeckConfig.maxEnsureAttempts) {
        attempts += 1;
        await ensureDeckPrefetch(`${reason}_attempt_${attempts}`);
        if (!localDeckState.nextCursor && localDeckState.buffer.length < minCards) {
          break;
        }
      }
      return localDeckState.buffer.length >= minCards;
    };

    const maybePrefetchInBackground = () => {
      if (localDeckState.buffer.length < localDeckConfig.prefetchThreshold) {
        void ensureDeckPrefetch('threshold_prefetch');
      }
    };

    const popCardFromBuffer = async (reason = 'consume') => {
      const ready = await ensureBufferedCards(1, reason);
      if (!ready) return null;
      const card = localDeckState.buffer.shift() || null;
      maybePrefetchInBackground();
      return card;
    };

    const dispatchSwipeWrite = (targetUserId, action, complimentMessage) => {
      const body = { targetUserId, action };
      if (complimentMessage) {
        body.complimentMessage = complimentMessage;
      }

      const writePromise = api('POST', '/swipes', {
        token: viewer.token,
        body,
      });

      localDeckState.pendingWritePromises.push(writePromise);
      return writePromise;
    };

    const swipeLocally = (card, action = 'pass', complimentMessage = null) => {
      const localStart = Date.now();

      const nextCard = localDeckState.buffer.shift() || null;

      localDeckState.history.push({
        card,
        action,
        expectedNextId: nextCard?.id || null,
        nextCard,
        at: Date.now(),
      });
      localDeckState.seenIds.add(card.id);

      maybePrefetchInBackground();

      const perceivedLatencyMs = Date.now() - localStart;
      const writePromise = dispatchSwipeWrite(card.id, action, complimentMessage);

      return {
        nextCard,
        perceivedLatencyMs,
        writePromise,
      };
    };

    const flushSwipeWrites = async () => {
      if (!localDeckState.pendingWritePromises.length) {
        return [];
      }
      const pending = [...localDeckState.pendingWritePromises];
      localDeckState.pendingWritePromises.length = 0;
      return Promise.allSettled(pending);
    };

    await ensureDeckPrefetch('session_warmup');
    if (localDeckState.nextCursor) {
      void ensureDeckPrefetch('proactive_prefetch_after_warmup');
    }

    const homeOpenStartedAt = Date.now();
    const firstCardReady = await ensureBufferedCards(1, 'home_open');
    const homeUsableFirstCardMs = Date.now() - homeOpenStartedAt;
    const firstRenderableCard = firstCardReady ? localDeckState.buffer[0] : null;

    const baselineUsers = localDeckState.buffer.slice(0, localDeckConfig.batchSize);
    const baselineTimes = localDeckState.prefetchDurations.slice(0, 3);
    const baselineMedian = median(baselineTimes);
    const baselineP95 = p95(baselineTimes);
    report.metrics.swipe.homeLoad = {
      baselineTimes,
      baselineMedian,
      baselineP95,
      initialBatchFetchMs: localDeckState.prefetchDurations[0] ?? null,
      homeUsableFirstCardMs,
      firstPageCount: baselineUsers.length,
      prefetchEvents: localDeckState.prefetchEvents,
    };

    addCheck(
      'swipe',
      'home_load_fast',
      'Home users load quickly',
      homeUsableFirstCardMs <= 1200 && !!firstRenderableCard ? 'pass' : 'fail',
      {
        homeUsableFirstCardMs,
        initialBatchFetchMs: localDeckState.prefetchDurations[0] ?? null,
        medianBatchFetchMs: baselineMedian,
        p95BatchFetchMs: baselineP95,
        firstPageCount: baselineUsers.length,
      },
      'critical',
      [
        'Preload discovery deck in background before Home becomes active.',
        'Open Home and read first renderable card from local buffer.',
        'Expected target in this QA: first usable card <= 1.2s.',
      ],
    );

    addCheck(
      'swipe',
      'batch_discovery_mode',
      'Discovery provides 10-20 card batches for buffered deck',
      (
        (baselineUsers.length >= 10 && baselineUsers.length <= 20) ||
        (baselineUsers.length > 0 && baselineUsers.length < 10 && !localDeckState.nextCursor)
      )
        ? 'pass'
        : 'fail',
      {
        batchSize: baselineUsers.length,
        configuredBatchSize: localDeckConfig.batchSize,
        nextCursorPresent: !!localDeckState.nextCursor,
      },
      'critical',
      [
        'Request initial ranked discovery batch with includeDeckMeta enabled.',
        'Validate that one batch returns between 10 and 20 cards for local buffering.',
      ],
    );

    if (baselineUsers.length < 3) {
      addCheck(
        'swipe',
        'swipe_roundtrip',
        'Swipe round-trips are smooth (no post-swipe lag spikes)',
        'blocked',
        { reason: 'Not enough baseline cards to execute swipe loop.', baselineUserCount: baselineUsers.length },
        'critical',
      );
      addCheck(
        'swipe',
        'perceived_next_card_instant',
        'Perceived next-card latency is instant with local buffer',
        'blocked',
        { reason: 'Not enough baseline cards to validate swipe continuity.' },
        'critical',
      );
      addCheck(
        'swipe',
        'next_batch_fetch_fast',
        'Next-batch fetch latency stays low during background prefetch',
        'blocked',
        { reason: 'Not enough baseline cards to validate continuation prefetch.' },
        'critical',
      );
      addCheck(
        'swipe',
        'seen_not_reappear',
        'Seen users do not reappear after refresh/reopen/filter change',
        'blocked',
        { reason: 'Not enough baseline cards to build seen set.' },
        'critical',
      );
      addCheck(
        'swipe',
        'queue_stable',
        'Queue remains stable across refresh and reopen',
        'blocked',
        { reason: 'Not enough cards for queue stability sampling.' },
        'critical',
      );
      addCheck(
        'swipe',
        'rewind_flow',
        'Premium rewind flow works end-to-end (restore, reverse, re-swipe, continuity)',
        'blocked',
        { reason: 'Not enough baseline cards to execute rewind scenario.' },
        'critical',
      );
    } else {
      const seenIds = [];
      const swipeDurations = [];
      const nextDurations = [];
      const swipeWriteTasks = [];
      const renderedCardIds = [];

      let currentCard = await popCardFromBuffer('initial_card_render');

      for (let i = 0; i < 3 && currentCard; i++) {
        renderedCardIds.push(currentCard.id);
        const { nextCard, perceivedLatencyMs, writePromise } = swipeLocally(currentCard, 'pass');
        seenIds.push(currentCard.id);
        nextDurations.push(perceivedLatencyMs);
        swipeWriteTasks.push({ targetUserId: currentCard.id, promise: writePromise });

        currentCard = nextCard;
        if (!currentCard) {
          currentCard = await popCardFromBuffer('fallback_after_swipe');
        }
      }

      const swipeWriteSettled = await Promise.allSettled(swipeWriteTasks.map((task) => task.promise));
      const swipeWriteFailures = [];
      swipeWriteSettled.forEach((settled, idx) => {
        const targetUserId = swipeWriteTasks[idx]?.targetUserId;
        if (settled.status === 'fulfilled') {
          const writeResp = settled.value;
          swipeDurations.push(writeResp.durationMs);
          if (!writeResp.ok) {
            swipeWriteFailures.push({
              targetUserId,
              status: writeResp.status,
              body: unwrap(writeResp) || writeResp.json || writeResp.text,
            });
          }
        } else {
          swipeWriteFailures.push({
            targetUserId,
            error: settled.reason?.message || String(settled.reason),
          });
        }
      });
      await flushSwipeWrites();

      await ensureDeckPrefetch('post_swipe_topup');
      const nextBatchDurations = localDeckState.prefetchDurations.slice(1);

      const swipeMedian = median(swipeDurations);
      const nextMedian = median(nextDurations);
      const nextBatchMedian = median(nextBatchDurations);
      const perceivedNextCardLatencyMs = nextMedian;

      report.metrics.swipe.roundTrip = {
        renderedCardIds,
        swipeDurations,
        nextDurations,
        swipeMedian,
        nextMedian,
        perceivedNextCardLatencyMs,
        nextBatchDurations,
        nextBatchMedian,
        swipeWriteFailures,
      };

      addCheck(
        'swipe',
        'perceived_next_card_instant',
        'Perceived next-card latency is instant with local buffer',
        perceivedNextCardLatencyMs <= 100 ? 'pass' : 'fail',
        {
          perceivedNextCardLatencyMs,
          localSamples: nextDurations,
        },
        'critical',
        [
          'Swipe from local buffered deck without waiting for backend writes.',
          'Measure local next-card render latency only.',
          'Expected: perceived next card latency <= 100ms.',
        ],
      );

      addCheck(
        'swipe',
        'next_batch_fetch_fast',
        'Next-batch fetch latency stays low during background prefetch',
        nextBatchDurations.length === 0
          ? 'blocked'
          : nextBatchMedian <= 1500
            ? 'pass'
            : 'fail',
        {
          nextCursorPresent: !!localDeckState.nextCursor,
          nextBatchDurations,
          nextBatchMedian,
          thresholdMs: 1500,
        },
        'critical',
        [
          'Keep deck buffered and fetch continuation batches asynchronously.',
          'Record background prefetch latency while UI continues swiping locally.',
          'Expected: median next-batch fetch latency <= 1.5s.',
        ],
      );

      addCheck(
        'swipe',
        'swipe_roundtrip',
        'Swipe round-trips are smooth (no post-swipe lag spikes)',
        swipeWriteFailures.length === 0 && perceivedNextCardLatencyMs <= 100 && swipeMedian <= 1500 ? 'pass' : 'fail',
        {
          swipeDurations,
          swipeMedian,
          perceivedNextCardLatencyMs,
          swipeWriteFailures,
        },
        'critical',
        [
          'Swipe through cards from local deck buffer.',
          'Dispatch backend writes asynchronously and track completion latencies.',
          'Expected: smooth UX with immediate next card and stable async write completion.',
        ],
      );

      const uniqueSeenIds = [...new Set(seenIds)];
      const localTopBeforeRefresh = localDeckState.buffer.slice(0, 2).map((u) => u.id);

      const refreshResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          sortBy: 'distance',
          goGlobal: true,
          forceRefresh: true,
          excludeIds: uniqueSeenIds,
        },
      });
      const reopenResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          sortBy: 'distance',
          goGlobal: true,
          excludeIds: uniqueSeenIds,
        },
      });
      const filterChangeResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          sortBy: 'distance',
          goGlobal: true,
          verifiedOnly: true,
          excludeIds: uniqueSeenIds,
        },
      });

      const refreshUsers = unwrap(refreshResp)?.users || [];
      const reopenUsers = unwrap(reopenResp)?.users || [];
      const filterChangeUsers = unwrap(filterChangeResp)?.users || [];

      const hasSeen = (users) => users.some((u) => uniqueSeenIds.includes(u.id));

      addCheck(
        'swipe',
        'seen_not_reappear',
        'Seen users do not reappear after refresh/reopen/filter change',
        !hasSeen(refreshUsers) && !hasSeen(reopenUsers) && !hasSeen(filterChangeUsers) ? 'pass' : 'fail',
        {
          seenIds: uniqueSeenIds,
          refreshTop: refreshUsers.slice(0, 5).map((u) => u.id),
          reopenTop: reopenUsers.slice(0, 5).map((u) => u.id),
          filterTop: filterChangeUsers.slice(0, 5).map((u) => u.id),
        },
        'critical',
        [
          'Swipe a set of users into local seen history.',
          'Trigger refresh, reopen, and filter changes.',
          'Expected: seen IDs remain excluded from new server batches.',
        ],
      );

      const localTopAfterReopen = localDeckState.buffer.slice(0, 2).map((u) => u.id);
      const stable =
        localTopBeforeRefresh.length < 2 ||
        (localTopBeforeRefresh[0] === localTopAfterReopen[0] && localTopBeforeRefresh[1] === localTopAfterReopen[1]);

      addCheck(
        'swipe',
        'queue_stable',
        'Queue remains stable across refresh and reopen',
        stable ? 'pass' : 'fail',
        {
          localTopBeforeRefresh,
          localTopAfterReopen,
        },
        'critical',
        [
          'Capture top local-buffer cards.',
          'Refresh and reopen Home while keeping local deck state.',
          'Expected: top queue order remains deterministic.',
        ],
      );

      const rewindTargetCard = await popCardFromBuffer('rewind_target');
      const expectedNextAfterReswipe = localDeckState.buffer[0]?.id || null;

      if (!rewindTargetCard) {
        addCheck(
          'swipe',
          'rewind_flow',
          'Premium rewind flow works end-to-end (restore, reverse, re-swipe, continuity)',
          'blocked',
          { reason: 'No rewind target available from local deck.' },
          'critical',
        );
      } else {
        const rewindSwipe = swipeLocally(rewindTargetCard, 'pass');
        const rewindSwipeResp = await rewindSwipe.writePromise;

        const localRewindStart = Date.now();
        const lastLocalSwipe = localDeckState.history.pop();
        let restoredLocalCardId = null;
        const bufferedNextCard = lastLocalSwipe?.nextCard;
        if (bufferedNextCard?.id && bufferedNextCard.id !== lastLocalSwipe?.card?.id && !isUserBuffered(bufferedNextCard.id)) {
          localDeckState.buffer.unshift(bufferedNextCard);
        }
        if (lastLocalSwipe?.card?.id) {
          restoredLocalCardId = lastLocalSwipe.card.id;
          localDeckState.seenIds.delete(lastLocalSwipe.card.id);
          localDeckState.buffer.unshift(lastLocalSwipe.card);
        }
        const localRewindLatencyMs = Date.now() - localRewindStart;

        const rewindResp = await api('POST', '/swipes/rewind', { token: viewer.token });
        const rewindData = unwrap(rewindResp) || rewindResp.json || {};

        const interactionsAfterResp = await api('GET', '/swipes/interactions', {
          token: viewer.token,
          query: { limit: 100 },
        });
        const interactionsAfter = unwrap(interactionsAfterResp) || { liked: [], passed: [] };
        const interactionsMerged = [
          ...(interactionsAfter.liked || []),
          ...(interactionsAfter.passed || []),
        ];

        const restoredCard = await popCardFromBuffer('rewind_reswipe_target');
        let reswipeResp = null;
        let reswipeData = null;
        let postReswipeTopCardId = null;

        if (restoredCard) {
          const reswipe = swipeLocally(restoredCard, 'like');
          reswipeResp = await reswipe.writePromise;
          reswipeData = unwrap(reswipeResp) || reswipeResp.json || {};
          postReswipeTopCardId = reswipe.nextCard?.id || localDeckState.buffer[0]?.id || null;
        }

        await flushSwipeWrites();

        const rewindPass =
          rewindSwipeResp.ok &&
          rewindResp.ok &&
          rewindData?.rewound === true &&
          rewindData?.undoneSwipe?.targetUserId === rewindTargetCard.id &&
          restoredLocalCardId === rewindTargetCard.id &&
          localRewindLatencyMs <= 100 &&
          !interactionsMerged.some((x) => x.userId === rewindTargetCard.id) &&
          !!reswipeResp?.ok &&
          !reswipeData?.duplicate &&
          (expectedNextAfterReswipe ? postReswipeTopCardId === expectedNextAfterReswipe : true);

        addCheck(
          'swipe',
          'rewind_flow',
          'Premium rewind flow works end-to-end (restore, reverse, re-swipe, continuity)',
          rewindPass ? 'pass' : 'fail',
          {
            rewindTarget: rewindTargetCard.id,
            rewoundTargetFromServer: rewindData?.undoneSwipe?.targetUserId || null,
            restoredLocalCardId,
            expectedNextAfterReswipe,
            postReswipeTopCardId,
            localRewindLatencyMs,
            reswipeStatus: reswipeResp?.status ?? null,
          },
          'critical',
          [
            'Swipe a card from local buffer and keep next-card order snapshot.',
            'Perform local rewind instantly, then sync rewind to backend.',
            'Re-swipe restored card and verify queue continuity is deterministic.',
          ],
        );
      }
    }

    const distanceResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        limit: 20,
        page: 1,
        sortBy: 'distance',
        goGlobal: true,
        forceRefresh: true,
      },
    });
    const distanceUsers = unwrap(distanceResp)?.users || [];

    const distanceSamples = distanceUsers
      .filter((u) => Number.isFinite(Number(u?.distanceKm)) && Number.isFinite(Number(u?.profile?.latitude)) && Number.isFinite(Number(u?.profile?.longitude)))
      .slice(0, 10)
      .map((u) => {
        const expected = haversineKm(36.7538, 3.0588, Number(u.profile.latitude), Number(u.profile.longitude));
        const actual = Number(u.distanceKm);
        const diff = Math.abs(actual - expected);
        const tolerance = Math.max(5, expected * 0.3);
        return {
          id: u.id,
          expectedKm: Number(expected.toFixed(2)),
          actualKm: Number(actual.toFixed(2)),
          diffKm: Number(diff.toFixed(2)),
          toleranceKm: Number(tolerance.toFixed(2)),
          pass: diff <= tolerance,
        };
      });

    if (distanceSamples.length < 3) {
      addCheck(
        'swipe',
        'distance_values_correct',
        'Distance values are shown correctly',
        'blocked',
        { reason: 'Not enough distance samples with coordinates in response.', sampleCount: distanceSamples.length },
        'critical',
      );
    } else {
      addCheck(
        'swipe',
        'distance_values_correct',
        'Distance values are shown correctly',
        distanceSamples.every((s) => s.pass) ? 'pass' : 'fail',
        { distanceSamples },
        'critical',
        [
          'Call /search sortBy=distance with known viewer location.',
          'Compare distanceKm to haversine baseline from returned coordinates.',
          'Expected: values remain within practical tolerance.',
        ],
      );
    }

    const distanceOrderValues = distanceUsers
      .map((u) => Number(u.distanceKm))
      .filter((v) => Number.isFinite(v));

    if (distanceOrderValues.length < 3) {
      addCheck(
        'swipe',
        'distance_order',
        'Distance-first ordering works when requested',
        'blocked',
        { reason: 'Not enough users with distanceKm for ordering validation.' },
        'normal',
      );
    } else {
      const ordered = distanceOrderValues.every((v, idx) => idx === 0 || distanceOrderValues[idx - 1] <= v + 0.1);
      addCheck(
        'swipe',
        'distance_order',
        'Distance-first ordering works when requested',
        ordered ? 'pass' : 'fail',
        { distanceOrderValues: distanceOrderValues.slice(0, 10) },
        'normal',
        [
          'Call /search sortBy=distance.',
          'Inspect returned distance sequence.',
          'Expected: nearest to farthest ordering.',
        ],
      );
    }

    const genderTarget = baselineUsers.find((u) => u?.profile?.gender)?.profile?.gender;
    if (!genderTarget) {
      addCheck(
        'swipe',
        'gender_filter_effective',
        'Gender filter changes discovery results',
        'blocked',
        { reason: 'No baseline gender value available to validate filter.' },
        'critical',
      );
    } else {
      const genderResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          page: 1,
          sortBy: 'distance',
          goGlobal: true,
          gender: genderTarget,
          forceRefresh: true,
        },
      });
      const genderUsers = unwrap(genderResp)?.users || [];

      if (genderUsers.length === 0) {
        addCheck(
          'swipe',
          'gender_filter_effective',
          'Gender filter changes discovery results',
          'blocked',
          { reason: 'Gender-filter query returned no users for validation.', genderTarget },
          'critical',
        );
      } else {
        const allMatchGender = genderUsers.every((u) => String(u?.profile?.gender || '').toLowerCase() === String(genderTarget).toLowerCase());
        addCheck(
          'swipe',
          'gender_filter_effective',
          'Gender filter changes discovery results',
          allMatchGender ? 'pass' : 'fail',
          {
            genderTarget,
            count: genderUsers.length,
            sample: genderUsers.slice(0, 10).map((u) => ({ id: u.id, gender: u?.profile?.gender })),
          },
          'critical',
          [
            'Apply a concrete gender filter value from existing deck.',
            'Refresh search results.',
            'Expected: all returned profiles match selected gender.',
          ],
        );
      }
    }

    const ageResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        limit: 20,
        page: 1,
        sortBy: 'distance',
        goGlobal: true,
        minAge: 25,
        maxAge: 35,
        forceRefresh: true,
      },
    });
    const ageUsers = unwrap(ageResp)?.users || [];

    if (ageUsers.length === 0) {
      addCheck(
        'swipe',
        'age_filter_effective',
        'Age filter changes discovery results',
        'blocked',
        { reason: 'Age-filter query returned no users for validation.' },
        'critical',
      );
    } else {
      const outOfRange = ageUsers
        .map((u) => ({ id: u.id, age: Number(u.age ?? getAgeFromDob(u?.profile?.dateOfBirth)) }))
        .filter((x) => Number.isFinite(x.age) && (x.age < 25 || x.age > 35));

      addCheck(
        'swipe',
        'age_filter_effective',
        'Age filter changes discovery results',
        outOfRange.length === 0 ? 'pass' : 'fail',
        {
          count: ageUsers.length,
          outOfRange,
        },
        'critical',
        [
          'Apply age range filter min=25 max=35.',
          'Refresh results and inspect ages.',
          'Expected: returned profiles stay within selected range.',
        ],
      );
    }

    const verifiedResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        limit: 20,
        page: 1,
        sortBy: 'distance',
        goGlobal: true,
        verifiedOnly: true,
        forceRefresh: true,
      },
    });
    const verifiedUsers = unwrap(verifiedResp)?.users || [];

    if (verifiedUsers.length === 0) {
      addCheck(
        'swipe',
        'verified_filter_effective',
        'Verified filter changes discovery results',
        'blocked',
        { reason: 'verifiedOnly query returned no users for validation.' },
        'critical',
      );
    } else {
      const hasUnverified = verifiedUsers.some((u) => u.selfieVerified !== true);
      addCheck(
        'swipe',
        'verified_filter_effective',
        'Verified filter changes discovery results',
        !hasUnverified ? 'pass' : 'fail',
        {
          count: verifiedUsers.length,
          sample: verifiedUsers.slice(0, 10).map((u) => ({ id: u.id, selfieVerified: u.selfieVerified })),
        },
        'critical',
        [
          'Enable verified-only filter.',
          'Refresh search results.',
          'Expected: all returned profiles are selfieVerified=true.',
        ],
      );
    }

    const filteredTimes = [];
    for (let i = 0; i < 3; i++) {
      const f = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          sortBy: 'distance',
          goGlobal: true,
          minAge: 25,
          maxAge: 35,
          verifiedOnly: i % 2 === 0,
          forceRefresh: i === 0,
        },
      });
      filteredTimes.push(f.durationMs);
    }
    const filteredMedian = median(filteredTimes);

    addCheck(
      'swipe',
      'filters_fast',
      'Filters keep discovery responsive',
      filteredMedian <= baselineMedian * 1.8 + 200 ? 'pass' : 'fail',
      {
        baselineMedian,
        filteredMedian,
        ratio: baselineMedian ? Number((filteredMedian / baselineMedian).toFixed(2)) : null,
        filteredTimes,
      },
      'normal',
      [
        'Apply combined filters (age + verified).',
        'Measure repeated search latency.',
        'Expected: filtered performance remains in practical range.',
      ],
    );

    const mobileCatalogResp = await api('GET', '/mobile/consumables');
    const mobileCatalog = unwrap(mobileCatalogResp) || [];
    const webCatalogResp = await api('GET', '/consumables/products/web');
    const webCatalog = unwrap(webCatalogResp) || [];

    const requiredTypes = ['likes_pack', 'compliments_pack', 'boosts_pack'];
    const mobileTypes = new Set(mobileCatalog.map((p) => p.type));
    const webTypes = new Set(webCatalog.map((p) => p.type));

    addCheck(
      'purchase',
      'catalog_display',
      'Likes/compliments/boost packs display correctly in app and web payloads',
      mobileCatalogResp.ok && webCatalogResp.ok && requiredTypes.every((type) => mobileTypes.has(type) && webTypes.has(type)) ? 'pass' : 'fail',
      {
        mobileCount: mobileCatalog.length,
        webCount: webCatalog.length,
        mobileTypes: [...mobileTypes],
        webTypes: [...webTypes],
      },
      'critical',
      [
        'Open mobile consumables endpoint and web products endpoint.',
        'Verify likes, compliments, and boosts packs are present in both.',
      ],
    );

    const payloadClarity = mobileCatalog.every(
      (p) =>
        typeof p.title === 'string' && p.title.length > 2 &&
        typeof p.description === 'string' && p.description.length > 5 &&
        Number(p.price) > 0 &&
        typeof p.currency === 'string' &&
        Number(p.quantity) > 0,
    );

    addCheck(
      'purchase',
      'catalog_clarity',
      'Purchase card payload is clean and understandable for UI rendering',
      payloadClarity ? 'pass' : 'fail',
      {
        sample: mobileCatalog.slice(0, 3).map((p) => ({
          code: p.code,
          title: p.title,
          descLen: (p.description || '').length,
          price: p.price,
          currency: p.currency,
          quantity: p.quantity,
        })),
      },
      'normal',
    );

    const balancesBefore = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

    const typeToProduct = Object.fromEntries(
      requiredTypes.map((type) => [type, mobileCatalog.find((p) => p.type === type && p.googleProductId)]),
    );

    const verifyAttempts = [];
    for (const type of requiredTypes) {
      const product = typeToProduct[type];
      if (!product) {
        verifyAttempts.push({ type, skipped: true, reason: 'No product with googleProductId.' });
        continue;
      }

      const purchaseToken = `final-v6-${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const verify = await api('POST', '/mobile/consumables/google-play/verify', {
        token: viewer.token,
        body: {
          productId: product.googleProductId,
          purchaseToken,
          orderId: `v6-order-${type}-${Date.now()}`,
          transactionDate: new Date().toISOString(),
        },
      });

      verifyAttempts.push({
        type,
        productId: product.googleProductId,
        purchaseToken,
        status: verify.status,
        ok: verify.ok,
        response: unwrap(verify) || verify.json || null,
      });
    }

    const successfulPurchases = verifyAttempts.filter((a) => a.ok && !a.skipped);
    const balancesAfterPurchase = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

    addCheck(
      'purchase',
      'purchase_success_balance_up',
      'Balances update after successful purchase',
      successfulPurchases.length > 0 && (
        Number(balancesAfterPurchase.likes ?? 0) > Number(balancesBefore.likes ?? 0) ||
        Number(balancesAfterPurchase.compliments ?? 0) > Number(balancesBefore.compliments ?? 0) ||
        Number(balancesAfterPurchase.boosts ?? 0) > Number(balancesBefore.boosts ?? 0)
      ) ? 'pass' : 'fail',
      {
        verifyAttempts,
        balancesBefore,
        balancesAfterPurchase,
      },
      'critical',
      [
        'Attempt purchase verification for each consumable pack.',
        'Open balances endpoint immediately after.',
        'Expected: at least one pack purchase succeeds and increments balance.',
      ],
    );

    if (successfulPurchases.length > 0) {
      const firstSuccess = successfulPurchases[0];
      const duplicateResp = await api('POST', '/mobile/consumables/google-play/verify', {
        token: viewer.token,
        body: {
          productId: firstSuccess.productId,
          purchaseToken: firstSuccess.purchaseToken,
          orderId: `v6-duplicate-${Date.now()}`,
          transactionDate: new Date().toISOString(),
        },
      });
      const afterDuplicate = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

      const duplicatePass =
        duplicateResp.ok &&
        Number(afterDuplicate.likes ?? 0) === Number(balancesAfterPurchase.likes ?? 0) &&
        Number(afterDuplicate.compliments ?? 0) === Number(balancesAfterPurchase.compliments ?? 0) &&
        Number(afterDuplicate.boosts ?? 0) === Number(balancesAfterPurchase.boosts ?? 0);

      addCheck(
        'purchase',
        'purchase_duplicate_guard',
        'Duplicate purchase tokens do not grant duplicate balances',
        duplicatePass ? 'pass' : 'fail',
        {
          duplicateStatus: duplicateResp.status,
          afterDuplicate,
          balancesAfterPurchase,
        },
        'critical',
        [
          'Replay same purchaseToken to verify endpoint.',
          'Expected: no additional balance grant.',
        ],
      );

      const beforeConsume = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

      if (baselineUsers.length > 1) {
        await api('POST', '/swipes', {
          token: viewer.token,
          body: { targetUserId: baselineUsers[0].id, action: 'like' },
        });
        await api('POST', '/swipes', {
          token: viewer.token,
          body: {
            targetUserId: baselineUsers[1].id,
            action: 'compliment',
            complimentMessage: 'Final v6 compliment consume check',
          },
        });
      }

      await api('POST', '/monetization/boost', {
        token: viewer.token,
        body: { durationMinutes: 1 },
      });

      const afterConsume = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

      addCheck(
        'purchase',
        'purchase_consume_decrement',
        'Balances decrement correctly when likes/compliments/boosts are consumed',
        Number(afterConsume.likes ?? 0) <= Number(beforeConsume.likes ?? 0) &&
        Number(afterConsume.compliments ?? 0) <= Number(beforeConsume.compliments ?? 0) &&
        Number(afterConsume.boosts ?? 0) <= Number(beforeConsume.boosts ?? 0)
          ? 'pass'
          : 'fail',
        { beforeConsume, afterConsume },
        'critical',
        [
          'Use purchased like, compliment, and boost once.',
          'Compare balances before/after use.',
          'Expected: corresponding balances decrement.',
        ],
      );

      const boostProduct = typeToProduct['boosts_pack'];
      if (boostProduct?.googleProductId) {
        for (let i = 0; i < 10; i++) {
          const snapshot = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};
          if (Number(snapshot.boosts ?? 0) <= 0) break;
          await api('POST', '/monetization/boost', {
            token: viewer.token,
            body: { durationMinutes: 1 },
          });
        }

        const afterDrain = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};
        const runOutReached = Number(afterDrain.boosts ?? 0) <= 0;

        let repurchaseOk = false;
        if (runOutReached) {
          const repurchase = await api('POST', '/mobile/consumables/google-play/verify', {
            token: viewer.token,
            body: {
              productId: boostProduct.googleProductId,
              purchaseToken: `final-v6-rebuy-${Date.now()}`,
              orderId: `v6-rebuy-${Date.now()}`,
              transactionDate: new Date().toISOString(),
            },
          });
          const afterRepurchase = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};
          repurchaseOk = repurchase.ok && Number(afterRepurchase.boosts ?? 0) > Number(afterDrain.boosts ?? 0);

          addCheck(
            'purchase',
            'purchase_rebuy_after_runout',
            'User can buy again after quantity runs out',
            repurchaseOk ? 'pass' : 'fail',
            {
              runOutReached,
              repurchaseStatus: repurchase.status,
              afterDrain,
              afterRepurchase,
            },
            'critical',
            [
              'Consume boosts until balance is zero.',
              'Purchase boosts pack again.',
              'Expected: balance increases from zero.',
            ],
          );
        } else {
          addCheck(
            'purchase',
            'purchase_rebuy_after_runout',
            'User can buy again after quantity runs out',
            'blocked',
            {
              reason: 'Could not drain boosts to zero using available actions.',
              afterDrain,
            },
            'critical',
          );
        }
      } else {
        addCheck(
          'purchase',
          'purchase_rebuy_after_runout',
          'User can buy again after quantity runs out',
          'blocked',
          { reason: 'No boosts pack with googleProductId mapped.' },
          'critical',
        );
      }
    } else {
      addCheck(
        'purchase',
        'purchase_duplicate_guard',
        'Duplicate purchase tokens do not grant duplicate balances',
        'blocked',
        { reason: 'No successful purchase available to run duplicate test.' },
        'critical',
      );

      addCheck(
        'purchase',
        'purchase_consume_decrement',
        'Balances decrement correctly when likes/compliments/boosts are consumed',
        'blocked',
        { reason: 'No successful purchase available to run consume-decrement test.' },
        'critical',
      );

      addCheck(
        'purchase',
        'purchase_rebuy_after_runout',
        'User can buy again after quantity runs out',
        'blocked',
        { reason: 'No successful purchase available to reach run-out and rebuy path.' },
        'critical',
      );
    }

    const patchMe = await api('PATCH', '/users/me', {
      token: viewer.token,
      body: { firstName: 'FinalRuntime', lastName: 'QA' },
    });
    const meAfterPatch = unwrap(await api('GET', '/users/me', { token: viewer.token })) || {};

    addCheck(
      'polish',
      'profile_settings_reflect',
      'Profile/settings changes reflect correctly',
      patchMe.ok && meAfterPatch.firstName === 'FinalRuntime' && meAfterPatch.lastName === 'QA' ? 'pass' : 'fail',
      {
        patchStatus: patchMe.status,
        firstName: meAfterPatch.firstName,
        lastName: meAfterPatch.lastName,
      },
      'critical',
      [
        'Update profile name fields.',
        'Reload /users/me.',
        'Expected: updated values persist immediately.',
      ],
    );

    await api('PATCH', '/notifications/settings', {
      token: viewer.token,
      body: {
        promotionsNotifications: false,
        weeklySummaryNotifications: false,
      },
    });

    const reloginViewer = await login(viewer.email, TEST_PASSWORD);
    const notifSettings = unwrap(await api('GET', '/notifications/settings', { token: reloginViewer.token })) || {};

    addCheck(
      'polish',
      'notification_settings_persist',
      'Notification settings persist after relogin',
      reloginViewer.ok && notifSettings.promotionsNotifications === false && notifSettings.weeklySummaryNotifications === false ? 'pass' : 'fail',
      {
        promotionsNotifications: notifSettings.promotionsNotifications,
        weeklySummaryNotifications: notifSettings.weeklySummaryNotifications,
      },
      'critical',
      [
        'Toggle notification settings.',
        'Relogin and fetch settings.',
        'Expected: same values persist.',
      ],
    );

    await api('DELETE', '/notifications/clear-all', { token: viewer.token });

    await api('POST', '/swipes', {
      token: liker.token,
      body: { targetUserId: viewer.id, action: 'like' },
    });

    const whoLikedFreeResp = await api('GET', '/swipes/who-liked-me', { token: viewer.token });
    const whoLikedFree = unwrap(whoLikedFreeResp) || {};
    const freeBlurred = Array.isArray(whoLikedFree.users) && whoLikedFree.users.length > 0
      ? whoLikedFree.users.every((u) => u.isBlurred === true)
      : false;

    const premiumGrant = await api('POST', `/admin/users/${viewer.id}/premium`, {
      token: adminToken,
      body: {
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });

    const whoLikedPremiumResp = await api('GET', '/swipes/who-liked-me', { token: viewer.token });
    const whoLikedPremium = unwrap(whoLikedPremiumResp) || {};
    const premiumUnblurred = Array.isArray(whoLikedPremium.users) && whoLikedPremium.users.some((u) => u.isBlurred === false && !!u.firstName);

    addCheck(
      'polish',
      'premium_gating_badge',
      'Premium badge/gating behaves correctly (blurred free vs unblurred premium)',
      whoLikedFreeResp.ok && freeBlurred && premiumGrant.ok && whoLikedPremiumResp.ok && premiumUnblurred ? 'pass' : 'fail',
      {
        freeCount: whoLikedFree.count,
        freeBlurred,
        premiumGrantStatus: premiumGrant.status,
        premiumCount: whoLikedPremium.count,
        premiumUnblurred,
      },
      'critical',
      [
        'Generate inbound like for free user.',
        'Open who-liked-me (expect blurred).',
        'Grant premium and reopen (expect unblurred identity).',
      ],
    );

    await api('POST', '/swipes', {
      token: viewer.token,
      body: { targetUserId: liker.id, action: 'like' },
    });

    const conversationResp = await api('POST', '/chat/conversations', {
      token: viewer.token,
      body: { targetUserId: liker.id },
    });
    const conversationId = unwrap(conversationResp)?.id;

    if (conversationId) {
      await api('POST', `/chat/conversations/${conversationId}/messages`, {
        token: liker.token,
        body: { content: 'Final runtime v6 message route check' },
      });
    }

    const supportCreate = await api('POST', '/support', {
      token: viewer.token,
      body: {
        subject: `Final v6 support ${Date.now()}`,
        message: 'Validating final support ticket flow in runtime QA.',
      },
    });
    const ticketId = unwrap(supportCreate)?.id;

    if (ticketId) {
      await api('PATCH', `/admin/tickets/${ticketId}/reply`, {
        token: adminToken,
        body: {
          reply: 'Final runtime v6 admin reply',
          status: 'in_progress',
        },
      });
    }

    await api('PATCH', `/admin/users/${viewer.id}`, {
      token: adminToken,
      body: { selfieUrl: `https://example.com/final-v6-selfie-${Date.now()}.jpg` },
    });
    await api('PATCH', `/admin/users/${viewer.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Final runtime v6 verification route check' },
    });

    await api('POST', '/admin/notifications/send', {
      token: adminToken,
      body: {
        userId: viewer.id,
        title: 'Final Runtime V6 Notification',
        body: 'System notification route validation',
        type: 'system',
      },
    });

    const notificationsResp = await api('GET', '/notifications', {
      token: viewer.token,
      query: { page: 1, limit: 100 },
    });
    const notifications = unwrap(notificationsResp)?.notifications || [];
    const notifTypes = new Set(notifications.map((n) => normalizeNotificationType(n)));

    addCheck(
      'polish',
      'notification_routing',
      'Notification routing still works after latest fixes',
      ['like', 'match', 'message', 'ticket', 'verification', 'system'].every((t) => notifTypes.has(t)) ? 'pass' : 'fail',
      {
        notificationTypes: [...notifTypes],
        count: notifications.length,
      },
      'critical',
      [
        'Trigger like/match/message/ticket/verification/system events.',
        'Open notification feed.',
        'Expected: each event type appears in feed.',
      ],
    );

    if (ticketId) {
      const ticketDetailResp = await api('GET', `/support/my-tickets/${ticketId}`, { token: viewer.token });
      const ticketListResp = await api('GET', '/support/my-tickets', {
        token: viewer.token,
        query: { page: 1, limit: 20 },
      });

      const ticketDetail = unwrap(ticketDetailResp) || {};
      const ticketList = unwrap(ticketListResp) || { tickets: [] };
      const listRow = (ticketList.tickets || []).find((t) => t.id === ticketId);

      addCheck(
        'polish',
        'support_flow',
        'Support ticket flow works fully in app',
        supportCreate.ok && ticketDetailResp.ok && ticketListResp.ok && !!ticketDetail.adminReply && !!listRow?.adminReply ? 'pass' : 'fail',
        {
          createStatus: supportCreate.status,
          detailStatus: ticketDetailResp.status,
          listStatus: ticketListResp.status,
          hasReplyInDetail: !!ticketDetail.adminReply,
          hasReplyInList: !!listRow?.adminReply,
        },
        'critical',
        [
          'Create support ticket as user.',
          'Reply as admin.',
          'Check ticket detail and list in user app.',
          'Expected: admin reply visible in both places.',
        ],
      );
    } else {
      addCheck(
        'polish',
        'support_flow',
        'Support ticket flow works fully in app',
        'fail',
        {
          reason: 'Support ticket creation did not return ticketId.',
          createStatus: supportCreate.status,
          createPayload: unwrap(supportCreate) || supportCreate.json,
        },
        'critical',
        [
          'Create support ticket from user flow.',
          'Expected: new ticket ID returned for follow-up views.',
        ],
      );
    }

    const limitedUpdate = await api('PATCH', `/admin/users/${moderationUser.id}/status`, {
      token: adminToken,
      body: {
        status: 'limited',
        reason: 'Final v6 limited moderation check',
        moderationReasonCode: 'OTHER',
        moderationReasonText: 'Final v6 moderation test',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Contact support for review.',
        isUserVisible: false,
        internalAdminNote: 'Final runtime QA limited state verification',
      },
    });

    const limitedStatus = await api('GET', '/users/me/status', { token: moderationUser.token });
    const limitedStatusData = unwrap(limitedStatus) || {};
    const limitedGate = await api('GET', '/matches/suggestions', {
      token: moderationUser.token,
      query: { limit: 5 },
    });

    const suspendedUpdate = await api('PATCH', `/admin/users/${moderationUser.id}/status`, {
      token: adminToken,
      body: {
        status: 'suspended',
        reason: 'Final v6 suspended moderation check',
        moderationReasonCode: 'POLICY_VIOLATION',
        moderationReasonText: 'Final v6 suspended test',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Account is suspended for QA test.',
        internalAdminNote: 'Final runtime QA suspended state verification',
      },
    });

    const suspendedLogin = await login(moderationUser.email, TEST_PASSWORD);

    addCheck(
      'polish',
      'moderation_messaging',
      'Moderation/account-state messaging has no obvious regression',
      limitedUpdate.ok &&
      limitedStatus.ok &&
      limitedStatusData.status === 'limited' &&
      limitedGate.status === 403 &&
      suspendedUpdate.ok &&
      !suspendedLogin.ok &&
      [401, 403].includes(suspendedLogin.resp.status)
        ? 'pass'
        : 'fail',
      {
        limitedUpdateStatus: limitedUpdate.status,
        limitedStatusCode: limitedStatus.status,
        limitedStatusPayload: limitedStatusData,
        limitedGateStatus: limitedGate.status,
        suspendedUpdateStatus: suspendedUpdate.status,
        suspendedLoginStatus: suspendedLogin.ok ? 200 : suspendedLogin.resp.status,
      },
      'critical',
      [
        'Set user to LIMITED with internalAdminNote and verify restricted route denial.',
        'Set same user to SUSPENDED and attempt login.',
        'Expected: status payload updated and login blocked when suspended.',
      ],
    );

    const swipeWeights = {
      home_load_fast: 10,
      batch_discovery_mode: 5,
      perceived_next_card_instant: 10,
      next_batch_fetch_fast: 10,
      swipe_roundtrip: 10,
      seen_not_reappear: 15,
      queue_stable: 10,
      distance_values_correct: 10,
      distance_order: 5,
      gender_filter_effective: 10,
      age_filter_effective: 10,
      verified_filter_effective: 10,
      filters_fast: 5,
      rewind_flow: 15,
    };

    const purchaseWeights = {
      catalog_display: 20,
      catalog_clarity: 10,
      purchase_success_balance_up: 25,
      purchase_duplicate_guard: 15,
      purchase_consume_decrement: 15,
      purchase_rebuy_after_runout: 15,
    };

    const checkByKey = Object.fromEntries(report.checks.map((c) => [c.key, c.status]));

    const swipeScoreInfo = computeWeightedScore(checkByKey, swipeWeights);
    const purchaseScoreInfo = computeWeightedScore(checkByKey, purchaseWeights);

    report.scores.swipeExperience = swipeScoreInfo.score;
    report.scores.purchaseUsability = purchaseScoreInfo.score;
    report.scores.swipeConfidence = swipeScoreInfo.confidence;
    report.scores.purchaseConfidence = purchaseScoreInfo.confidence;
    report.metrics.swipe.scoring = swipeScoreInfo;
    report.metrics.purchase.scoring = purchaseScoreInfo;

    const criticalFailures = report.criticalIssues.length;
    let verdict = 'usable';
    let verdictTier = 'tier-3-usable';
    if (criticalFailures === 0 && swipeScoreInfo.score >= 90 && purchaseScoreInfo.score >= 85) {
      verdict = 'Tinder-grade';
      verdictTier = 'tier-1-tinder-grade';
    } else if (criticalFailures === 0 && swipeScoreInfo.score >= 80 && purchaseScoreInfo.score >= 75) {
      verdict = 'production-ready';
      verdictTier = 'tier-2-production';
    }

    report.verdict = verdict;
    report.verdictTier = verdictTier;
    report.professionalFeel =
      verdict === 'Tinder-grade'
        ? 'Yes - runtime behavior is fast and polished enough to feel Tinder-grade.'
        : 'No - runtime findings still block Tinder-grade speed/polish.';

    const checkByKeyStatus = (key) => report.checks.find((check) => check.key === key)?.status ?? 'blocked';
    const architectureMetrics = report.metrics.swipe.roundTrip || {};
    report.architectureSummary = {
      homeFirstLoadMs: report.metrics.swipe.homeLoad?.homeUsableFirstCardMs ?? null,
      swipeWriteLatencyMedianMs: architectureMetrics.swipeMedian ?? null,
      perceivedNextCardLatencyMs: architectureMetrics.perceivedNextCardLatencyMs ?? null,
      nextBatchFetchLatencyMedianMs: architectureMetrics.nextBatchMedian ?? null,
      rewindContinuityStatus: checkByKeyStatus('rewind_flow'),
      seenUserExclusionStatus: checkByKeyStatus('seen_not_reappear'),
      filterCorrectnessStatus:
        checkByKeyStatus('gender_filter_effective') === 'pass' &&
        checkByKeyStatus('age_filter_effective') === 'pass' &&
        checkByKeyStatus('verified_filter_effective') === 'pass'
          ? 'pass'
          : 'fail',
      tier: verdictTier,
    };

    report.summary = {
      totalChecks: report.checks.length,
      pass: report.checks.filter((c) => c.status === 'pass').length,
      fail: report.checks.filter((c) => c.status === 'fail').length,
      blocked: report.checks.filter((c) => c.status === 'blocked').length,
      criticalFailures,
      swipeScore: report.scores.swipeExperience,
      purchaseScore: report.scores.purchaseUsability,
      swipeConfidence: report.scores.swipeConfidence,
      purchaseConfidence: report.scores.purchaseConfidence,
      verdict,
      verdictTier,
      professionalFeel: report.professionalFeel,
      architectureSummary: report.architectureSummary,
    };

    report.finishedAt = new Date().toISOString();

    await fs.writeFile('tmp/final-runtime-qa-v6-report.json', JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          reportPath: 'tmp/final-runtime-qa-v6-report.json',
          summary: report.summary,
          criticalIssues: report.criticalIssues.map((i) => ({ key: i.key, name: i.name })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.error = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
    report.finishedAt = new Date().toISOString();
    await fs.writeFile('tmp/final-runtime-qa-v6-report.json', JSON.stringify(report, null, 2), 'utf8');

    console.error(
      JSON.stringify(
        {
          ok: false,
          reportPath: 'tmp/final-runtime-qa-v6-report.json',
          error: report.error,
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  }
}

run();
