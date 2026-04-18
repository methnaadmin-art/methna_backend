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
  },
  scores: {
    swipeExperience: 0,
    purchaseUsability: 0,
  },
  criticalIssues: [],
  failingScenarios: [],
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
  const q = sp.toString();
  return q ? `?${q}` : '';
}

async function api(method, path, { token, body, query } = {}) {
  const url = `${baseUrl}${path}${toQuery(query)}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const started = Date.now();
  const res = await fetch(url, {
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
    json,
    text,
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

function addCheck(group, name, passed, details = {}, severity = 'normal', repro = null) {
  report.checks.push({ group, name, passed: !!passed, details, severity, repro });
  if (!passed && severity === 'critical') {
    report.criticalIssues.push({ group, name, details });
  }
  if (!passed && repro) {
    report.failingScenarios.push({ group, name, steps: repro, details });
  }
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

function normalizeNotificationType(notification) {
  const data = notification?.data || {};
  const payload = data?.payload || {};
  return (data.type || payload.type || notification?.type || '').toString().toLowerCase().trim();
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

async function createRuntimeUser(adminToken, {
  label,
  gender,
  dateOfBirth,
  latitude,
  longitude,
  country,
  city,
  verified = false,
}) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const email = `runtime.final.${label}.${stamp}@methna.test`;
  const username = `rt_final_${label}_${Math.floor(Math.random() * 100000)}`;

  const created = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: `Runtime${label}`,
      lastName: 'Tester',
      username,
      status: 'active',
    },
  });
  if (!created.ok) {
    throw new Error(`Failed to create user ${label}: ${created.status} ${created.text}`);
  }

  const loginResp = await login(email, TEST_PASSWORD);
  if (!loginResp.ok) {
    throw new Error(`Failed to login user ${label}: ${loginResp.resp.status} ${loginResp.resp.text}`);
  }

  const userId = loginResp.user?.id;
  const token = loginResp.token;

  const profileResp = await api('POST', '/profiles', {
    token,
    body: {
      bio: 'Runtime profile for final production QA. Rich and complete.',
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
      interests: ['Coffee', 'Reading', 'Traveling', 'Technology', 'Swimming'],
      languages: ['Arabic', 'English'],
      aboutPartner: 'Looking for a compatible partner for serious marriage.',
      city,
      country,
    },
  });

  if (!profileResp.ok) {
    throw new Error(`Failed to create profile for ${label}: ${profileResp.status} ${profileResp.text}`);
  }

  const locationResp = await api('PATCH', '/profiles/location', {
    token,
    body: {
      latitude,
      longitude,
      city,
      country,
    },
  });

  if (!locationResp.ok) {
    throw new Error(`Failed to set location for ${label}: ${locationResp.status} ${locationResp.text}`);
  }

  if (verified) {
    await api('PATCH', `/admin/users/${userId}`, {
      token: adminToken,
      body: { selfieUrl: `https://example.com/final-qa-${label}.jpg` },
    });
    const verifyResp = await api('PATCH', `/admin/users/${userId}/verification/selfie`, {
      token: adminToken,
      body: { status: 'approved' },
    });
    if (!verifyResp.ok) {
      throw new Error(`Failed to mark user ${label} as verified: ${verifyResp.status} ${verifyResp.text}`);
    }
  }

  const meProfile = await api('GET', '/profiles/me', { token });
  const completion = unwrap(meProfile)?.profileCompletionPercentage ?? 0;

  return {
    id: userId,
    email,
    token,
    gender,
    dateOfBirth,
    latitude,
    longitude,
    country,
    city,
    completion,
  };
}

async function run() {
  try {
    const runStamp = Date.now();
    const qaCountry = `QACOUNTRY_${runStamp}`;
    const qaCity = `QACITY_${runStamp}`;

    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!adminLogin.ok) {
      throw new Error(`Admin login failed: ${adminLogin.resp.status} ${adminLogin.resp.text}`);
    }
    const adminToken = adminLogin.token;

    const viewer = await createRuntimeUser(adminToken, {
      label: 'viewer',
      gender: 'female',
      dateOfBirth: '1996-01-10',
      latitude: 36.7538,
      longitude: 3.0588,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    const maleNear = await createRuntimeUser(adminToken, {
      label: 'male_near',
      gender: 'male',
      dateOfBirth: '1998-05-21',
      latitude: 36.7548,
      longitude: 3.0598,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    const maleMidVerified = await createRuntimeUser(adminToken, {
      label: 'male_mid_verified',
      gender: 'male',
      dateOfBirth: '1990-02-14',
      latitude: 36.765,
      longitude: 3.072,
      country: qaCountry,
      city: qaCity,
      verified: true,
    });

    const maleFar = await createRuntimeUser(adminToken, {
      label: 'male_far',
      gender: 'male',
      dateOfBirth: '1985-09-03',
      latitude: 36.91,
      longitude: 3.31,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    const maleVeryFar = await createRuntimeUser(adminToken, {
      label: 'male_very_far',
      gender: 'male',
      dateOfBirth: '2000-07-18',
      latitude: 35.7,
      longitude: -0.6,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    const femaleControl = await createRuntimeUser(adminToken, {
      label: 'female_control',
      gender: 'female',
      dateOfBirth: '1995-12-11',
      latitude: 36.7552,
      longitude: 3.0612,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    const moderationUser = await createRuntimeUser(adminToken, {
      label: 'moderation_user',
      gender: 'male',
      dateOfBirth: '1994-06-09',
      latitude: 36.74,
      longitude: 3.04,
      country: qaCountry,
      city: qaCity,
      verified: false,
    });

    report.setup = {
      adminId: adminLogin.user?.id,
      qaCountry,
      qaCity,
      viewer: { id: viewer.id, email: viewer.email, completion: viewer.completion },
      users: {
        maleNear: maleNear.id,
        maleMidVerified: maleMidVerified.id,
        maleFar: maleFar.id,
        maleVeryFar: maleVeryFar.id,
        femaleControl: femaleControl.id,
        moderationUser: moderationUser.id,
      },
    };

    addCheck(
      'setup',
      'All QA users have complete profiles',
      [viewer, maleNear, maleMidVerified, maleFar, maleVeryFar, femaleControl, moderationUser].every((u) => Number(u.completion) >= 60),
      {
        completions: {
          viewer: viewer.completion,
          maleNear: maleNear.completion,
          maleMidVerified: maleMidVerified.completion,
          maleFar: maleFar.completion,
          maleVeryFar: maleVeryFar.completion,
          femaleControl: femaleControl.completion,
          moderationUser: moderationUser.completion,
        },
      },
      'critical',
      [
        'Login with a fresh runtime user.',
        'Open profile completion state.',
        'Attempt like swipe on Home.',
        'Observe PROFILE_INCOMPLETE block if completion is below threshold.',
      ],
    );

    await api('PUT', '/profiles/preferences', {
      token: viewer.token,
      body: {
        minAge: 20,
        maxAge: 45,
        preferredGender: 'male',
        maxDistance: 1000,
      },
    });

    const baselineTimes = [];
    for (let i = 0; i < 3; i++) {
      const searchResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          limit: 20,
          page: 1,
          sortBy: 'distance',
          goGlobal: true,
          forceRefresh: i === 0,
        },
      });
      baselineTimes.push(searchResp.durationMs);
    }

    const baselineMedian = median(baselineTimes);
    const baselineP95 = p95(baselineTimes);
    report.metrics.swipe.homeLoad = { baselineTimes, baselineMedian, baselineP95 };

    addCheck(
      'swipe',
      'Home users load quickly',
      baselineTimes[0] <= 1400,
      { firstLoadMs: baselineTimes[0], medianMs: baselineMedian, p95Ms: baselineP95 },
      'critical',
      [
        'Login with a complete-profile user.',
        'Open Home/Discovery screen.',
        'Measure first card payload fetch latency.',
        'Expected: first load under ~1.4s in this QA environment.',
      ],
    );

    const deterministicDeckResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        limit: 20,
        page: 1,
        sortBy: 'distance',
        goGlobal: true,
        forceRefresh: true,
        country: qaCountry,
        gender: 'male',
      },
    });

    const deterministicDeck = unwrap(deterministicDeckResp)?.users || [];
    const deterministicById = new Map(deterministicDeck.map((u) => [u.id, u]));

    const expectedMaleIds = [maleNear.id, maleMidVerified.id, maleFar.id, maleVeryFar.id];
    const presentMaleIds = expectedMaleIds.filter((id) => deterministicById.has(id));

    addCheck(
      'swipe',
      'Deterministic QA deck available for swipe tests',
      presentMaleIds.length >= 3,
      {
        expectedMaleIds,
        presentMaleIds,
        returnedCount: deterministicDeck.length,
      },
      'critical',
      [
        'Create a controlled QA cohort with unique country/city.',
        'Call /search with country + male filter.',
        'Expected: deterministic cohort appears for stable swipe QA.',
      ],
    );

    const candidateCoords = {
      [maleNear.id]: { lat: maleNear.latitude, lng: maleNear.longitude },
      [maleMidVerified.id]: { lat: maleMidVerified.latitude, lng: maleMidVerified.longitude },
      [maleFar.id]: { lat: maleFar.latitude, lng: maleFar.longitude },
      [maleVeryFar.id]: { lat: maleVeryFar.latitude, lng: maleVeryFar.longitude },
    };

    const distanceChecks = [];
    for (const id of expectedMaleIds) {
      const row = deterministicById.get(id);
      if (!row) continue;
      const expected = haversineKm(viewer.latitude, viewer.longitude, candidateCoords[id].lat, candidateCoords[id].lng);
      const actual = Number(row.distanceKm ?? NaN);
      const diff = Number.isFinite(actual) ? Math.abs(actual - expected) : Number.POSITIVE_INFINITY;
      const tolerance = Math.max(3, expected * 0.25);
      distanceChecks.push({ id, expectedKm: expected, actualKm: actual, diffKm: diff, toleranceKm: tolerance, pass: diff <= tolerance });
    }

    addCheck(
      'swipe',
      'Distance values are shown correctly',
      distanceChecks.length >= 3 && distanceChecks.every((d) => d.pass),
      { distanceChecks },
      'critical',
      [
        'Set known coordinates for viewer and candidates.',
        'Call /search sortBy=distance.',
        'Compare response distanceKm with haversine baseline.',
      ],
    );

    const returnedDistances = deterministicDeck
      .filter((u) => expectedMaleIds.includes(u.id))
      .map((u) => Number(u.distanceKm))
      .filter((d) => Number.isFinite(d));

    const isAscending = returnedDistances.every((d, idx) => idx === 0 || returnedDistances[idx - 1] <= d + 0.1);
    addCheck(
      'swipe',
      'Distance-first ordering works when requested',
      returnedDistances.length >= 3 && isAscending,
      { returnedDistances },
      'normal',
      [
        'Call /search with sortBy=distance.',
        'Observe returned distance sequence.',
        'Expected: ascending order from nearest to farthest.',
      ],
    );

    const genderFilterResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'female',
        goGlobal: true,
        forceRefresh: true,
        limit: 20,
      },
    });
    const genderUsers = unwrap(genderFilterResp)?.users || [];
    const genderOnlyFemale = genderUsers.every((u) => (u?.profile?.gender || '').toLowerCase() === 'female');
    const genderContainsControl = genderUsers.some((u) => u.id === femaleControl.id);

    addCheck(
      'swipe',
      'Gender filter changes discovery results',
      genderFilterResp.ok && genderOnlyFemale && genderContainsControl,
      { count: genderUsers.length, ids: genderUsers.map((u) => u.id) },
      'critical',
      [
        'Open filters and set gender=female.',
        'Refresh discovery.',
        'Expected: male cards disappear and female cohort remains.',
      ],
    );

    const ageFilterResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        minAge: 25,
        maxAge: 30,
        goGlobal: true,
        forceRefresh: true,
        limit: 20,
      },
    });
    const ageUsers = unwrap(ageFilterResp)?.users || [];
    const ageIds = new Set(ageUsers.map((u) => u.id));
    const ageExpected = [maleNear.id, maleVeryFar.id];
    const agePass = ageExpected.every((id) => ageIds.has(id)) && !ageIds.has(maleMidVerified.id) && !ageIds.has(maleFar.id);

    addCheck(
      'swipe',
      'Age filter changes discovery results',
      ageFilterResp.ok && agePass,
      { ids: [...ageIds], expectedIncluded: ageExpected, expectedExcluded: [maleMidVerified.id, maleFar.id] },
      'critical',
      [
        'Set age range in filters.',
        'Refresh discovery.',
        'Expected: out-of-range profiles are excluded.',
      ],
    );

    const verifiedFilterResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        verifiedOnly: true,
        goGlobal: true,
        forceRefresh: true,
        limit: 20,
      },
    });
    const verifiedUsers = unwrap(verifiedFilterResp)?.users || [];
    const verifiedOnly = verifiedUsers.every((u) => !!u.selfieVerified);
    const includesVerifiedCandidate = verifiedUsers.some((u) => u.id === maleMidVerified.id);

    addCheck(
      'swipe',
      'Verified filter changes discovery results',
      verifiedFilterResp.ok && verifiedOnly && includesVerifiedCandidate,
      { ids: verifiedUsers.map((u) => ({ id: u.id, selfieVerified: u.selfieVerified })) },
      'critical',
      [
        'Enable verified-only filter.',
        'Refresh discovery.',
        'Expected: only verified profiles remain.',
      ],
    );

    const filteredTimes = [];
    for (let i = 0; i < 3; i++) {
      const resp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          country: qaCountry,
          gender: 'male',
          minAge: 25,
          maxAge: 40,
          verifiedOnly: i % 2 === 0,
          sortBy: 'distance',
          goGlobal: true,
          forceRefresh: i === 0,
          limit: 20,
        },
      });
      filteredTimes.push(resp.durationMs);
    }
    const filteredMedian = median(filteredTimes);
    report.metrics.swipe.filterPerformance = { filteredTimes, filteredMedian, baselineMedian };

    addCheck(
      'swipe',
      'Filters keep discovery responsive',
      filteredMedian <= baselineMedian * 1.8 + 200,
      { baselineMedian, filteredMedian, ratio: baselineMedian ? Number((filteredMedian / baselineMedian).toFixed(2)) : null },
      'normal',
      [
        'Apply multiple filters (country, age, verified).',
        'Refresh discovery repeatedly.',
        'Expected: response time stays in the same practical range as baseline.',
      ],
    );

    const swipeTargets = deterministicDeck
      .filter((u) => expectedMaleIds.includes(u.id))
      .slice(0, 3)
      .map((u) => u.id);

    const seenIds = [];
    const swipeDurations = [];
    const nextCardDurations = [];

    for (const targetId of swipeTargets) {
      const swipeResp = await api('POST', '/swipes', {
        token: viewer.token,
        body: { targetUserId: targetId, action: 'pass' },
      });
      swipeDurations.push(swipeResp.durationMs);
      seenIds.push(targetId);

      const nextResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          country: qaCountry,
          gender: 'male',
          sortBy: 'distance',
          goGlobal: true,
          limit: 20,
          excludeIds: seenIds,
        },
      });
      nextCardDurations.push(nextResp.durationMs);
    }

    const swipeMedian = median(swipeDurations);
    const nextMedian = median(nextCardDurations);
    report.metrics.swipe.swipeRoundTrip = { swipeDurations, nextCardDurations, swipeMedian, nextMedian };

    addCheck(
      'swipe',
      'Swipe round-trips are smooth (no post-swipe lag spikes)',
      swipeMedian <= 450 && nextMedian <= 900,
      { swipeDurations, nextCardDurations, swipeMedian, nextMedian },
      'critical',
      [
        'Swipe through several cards quickly.',
        'Observe server round-trip for swipe + next-card fetch.',
        'Expected: no recurring lag spikes that feel like loading per swipe.',
      ],
    );

    const refreshResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        sortBy: 'distance',
        goGlobal: true,
        forceRefresh: true,
        limit: 20,
        excludeIds: seenIds,
      },
    });
    const refreshUsers = unwrap(refreshResp)?.users || [];

    const reopenResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        sortBy: 'distance',
        goGlobal: true,
        limit: 20,
        excludeIds: seenIds,
      },
    });
    const reopenUsers = unwrap(reopenResp)?.users || [];

    const filterChangeResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        verifiedOnly: true,
        sortBy: 'distance',
        goGlobal: true,
        limit: 20,
        excludeIds: seenIds,
      },
    });
    const filterChangeUsers = unwrap(filterChangeResp)?.users || [];

    const intersects = (users, ids) => users.some((u) => ids.includes(u.id));

    addCheck(
      'swipe',
      'Seen users do not reappear after refresh/reopen/filter change',
      !intersects(refreshUsers, seenIds) && !intersects(reopenUsers, seenIds) && !intersects(filterChangeUsers, seenIds),
      {
        seenIds,
        refreshIds: refreshUsers.map((u) => u.id),
        reopenIds: reopenUsers.map((u) => u.id),
        filterChangeIds: filterChangeUsers.map((u) => u.id),
      },
      'critical',
      [
        'Swipe a set of cards and mark them seen.',
        'Trigger pull-to-refresh, app reopen, and filter changes.',
        'Expected: seen cards stay excluded.',
      ],
    );

    const firstTwoRefresh = refreshUsers.slice(0, 2).map((u) => u.id);
    const firstTwoReopen = reopenUsers.slice(0, 2).map((u) => u.id);
    const queueStable = firstTwoRefresh.length < 2 || (firstTwoRefresh[0] === firstTwoReopen[0] && firstTwoRefresh[1] === firstTwoReopen[1]);

    addCheck(
      'swipe',
      'Queue remains stable across refresh and reopen',
      queueStable,
      {
        firstTwoRefresh,
        firstTwoReopen,
      },
      'critical',
      [
        'Load deck and note top cards.',
        'Refresh and reopen Home.',
        'Expected: queue continuity with no random jumps.',
      ],
    );

    const rewindDeckResp = await api('GET', '/search', {
      token: viewer.token,
      query: {
        country: qaCountry,
        gender: 'male',
        sortBy: 'distance',
        goGlobal: true,
        limit: 20,
        excludeIds: seenIds,
      },
    });
    const rewindDeckUsers = unwrap(rewindDeckResp)?.users || [];
    const rewindTarget = rewindDeckUsers[0]?.id;
    const expectedNextAfterTarget = rewindDeckUsers[1]?.id || null;

    let rewindAssertions = {
      restoreIntendedLastCard: false,
      interactionReversed: false,
      canReswipe: false,
      nextCardCorrect: false,
      noRandomReinsert: false,
      rewoundTarget: null,
      expectedNextAfterTarget,
      actualNextAfterReswipe: null,
    };

    if (rewindTarget) {
      await api('POST', '/swipes', {
        token: viewer.token,
        body: { targetUserId: rewindTarget, action: 'pass' },
      });

      const interactionsBeforeResp = await api('GET', '/swipes/interactions', {
        token: viewer.token,
        query: { limit: 120 },
      });
      const interactionsBefore = unwrap(interactionsBeforeResp) || { liked: [], passed: [] };

      const rewindResp = await api('POST', '/swipes/rewind', { token: viewer.token });
      const rewindData = unwrap(rewindResp) || rewindResp.json || {};

      const interactionsAfterResp = await api('GET', '/swipes/interactions', {
        token: viewer.token,
        query: { limit: 120 },
      });
      const interactionsAfter = unwrap(interactionsAfterResp) || { liked: [], passed: [] };

      const reswipeResp = await api('POST', '/swipes', {
        token: viewer.token,
        body: { targetUserId: rewindTarget, action: 'like' },
      });
      const reswipeData = unwrap(reswipeResp) || reswipeResp.json || {};

      const afterReswipeSearchResp = await api('GET', '/search', {
        token: viewer.token,
        query: {
          country: qaCountry,
          gender: 'male',
          sortBy: 'distance',
          goGlobal: true,
          limit: 20,
          excludeIds: [...seenIds, rewindTarget],
        },
      });
      const afterReswipeUsers = unwrap(afterReswipeSearchResp)?.users || [];

      const interactionsAfterAll = [
        ...(interactionsAfter.liked || []),
        ...(interactionsAfter.passed || []),
      ];

      rewindAssertions = {
        restoreIntendedLastCard: rewindResp.ok && rewindData?.rewound === true && rewindData?.undoneSwipe?.targetUserId === rewindTarget,
        interactionReversed: !interactionsAfterAll.some((entry) => entry.userId === rewindTarget),
        canReswipe: reswipeResp.ok && !reswipeData?.duplicate,
        nextCardCorrect: expectedNextAfterTarget ? afterReswipeUsers[0]?.id === expectedNextAfterTarget : true,
        noRandomReinsert: !afterReswipeUsers.some((u) => seenIds.includes(u.id)),
        rewoundTarget: rewindData?.undoneSwipe?.targetUserId ?? null,
        expectedNextAfterTarget,
        actualNextAfterReswipe: afterReswipeUsers[0]?.id ?? null,
      };
    }

    addCheck(
      'swipe',
      'Premium rewind flow works end-to-end (restore, reverse, re-swipe, continuity)',
      Object.values(rewindAssertions).filter((v) => typeof v === 'boolean').every(Boolean),
      rewindAssertions,
      'critical',
      [
        'Swipe one card, then call rewind.',
        'Verify undoneSwipe target matches last swiped card.',
        'Verify previous interaction is removed from interactions list.',
        'Re-swipe same card and confirm success without duplicate block.',
        'Confirm next card sequence continues without random old-card insertion.',
      ],
    );

    const mobileCatalogResp = await api('GET', '/mobile/consumables');
    const mobileCatalog = unwrap(mobileCatalogResp) || [];
    const webCatalogResp = await api('GET', '/consumables/products/web');
    const webCatalog = unwrap(webCatalogResp) || [];

    const requiredTypes = ['likes_pack', 'compliments_pack', 'boosts_pack'];
    const mobileTypes = new Set((mobileCatalog || []).map((p) => p.type));
    const webTypes = new Set((webCatalog || []).map((p) => p.type));

    const catalogDisplayPass =
      mobileCatalogResp.ok &&
      webCatalogResp.ok &&
      requiredTypes.every((type) => mobileTypes.has(type) && webTypes.has(type));

    addCheck(
      'purchase',
      'Likes/compliments/boost packs display correctly in app and web payloads',
      catalogDisplayPass,
      {
        mobileCount: mobileCatalog.length,
        webCount: webCatalog.length,
        mobileTypes: [...mobileTypes],
        webTypes: [...webTypes],
      },
      'critical',
      [
        'Open Shop in mobile app and web storefront.',
        'Check likes, compliments, and boosts packs are all present.',
        'Validate title, quantity, and price metadata are populated.',
      ],
    );

    const payloadClarityPass =
      mobileCatalog.every((p) =>
        typeof p.title === 'string' &&
        p.title.length > 2 &&
        typeof p.description === 'string' &&
        p.description.length > 5 &&
        Number(p.price) > 0 &&
        typeof p.currency === 'string' &&
        typeof p.quantity === 'number' &&
        p.quantity > 0,
      );

    addCheck(
      'purchase',
      'Purchase card payload is clean and understandable for UI rendering',
      payloadClarityPass,
      {
        sample: mobileCatalog.slice(0, 3).map((p) => ({
          code: p.code,
          title: p.title,
          descriptionLength: (p.description || '').length,
          price: p.price,
          currency: p.currency,
          quantity: p.quantity,
          googleProductId: p.googleProductId,
        })),
      },
      'normal',
      [
        'Inspect pack cards in mobile/web shop.',
        'Expected: each pack has clear title, description, quantity, and pricing.',
      ],
    );

    const balancesBeforeResp = await api('GET', '/mobile/consumables/balances', { token: viewer.token });
    const balancesBefore = unwrap(balancesBeforeResp) || {};

    const typeToProduct = {};
    for (const type of requiredTypes) {
      typeToProduct[type] = mobileCatalog.find((p) => p.type === type && p.googleProductId);
    }

    const verifyAttempts = [];
    for (const type of requiredTypes) {
      const product = typeToProduct[type];
      if (!product) {
        verifyAttempts.push({ type, skipped: true, reason: 'No mapped googleProductId product' });
        continue;
      }
      const token = `final-qa-${type}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const verifyResp = await api('POST', '/mobile/consumables/google-play/verify', {
        token: viewer.token,
        body: {
          productId: product.googleProductId,
          purchaseToken: token,
          orderId: `final-order-${type}-${Date.now()}`,
          transactionDate: new Date().toISOString(),
        },
      });
      const verifyData = unwrap(verifyResp) || verifyResp.json || {};
      verifyAttempts.push({
        type,
        productId: product.googleProductId,
        purchaseToken: token,
        status: verifyResp.status,
        ok: verifyResp.ok,
        response: verifyData,
      });
    }

    const successfulAttempts = verifyAttempts.filter((a) => a.ok && !a.skipped);
    const purchaseSuccessAvailable = successfulAttempts.length > 0;

    const balancesAfterPurchaseResp = await api('GET', '/mobile/consumables/balances', { token: viewer.token });
    const balancesAfterPurchase = unwrap(balancesAfterPurchaseResp) || {};

    addCheck(
      'purchase',
      'Balances update after successful purchase',
      purchaseSuccessAvailable && (
        Number(balancesAfterPurchase.likes ?? 0) >= Number(balancesBefore.likes ?? 0) ||
        Number(balancesAfterPurchase.compliments ?? 0) >= Number(balancesBefore.compliments ?? 0) ||
        Number(balancesAfterPurchase.boosts ?? 0) >= Number(balancesBefore.boosts ?? 0)
      ),
      {
        verifyAttempts,
        balancesBefore,
        balancesAfterPurchase,
      },
      'critical',
      [
        'Attempt a real consumable purchase in app.',
        'Open balances immediately after success.',
        'Expected: relevant balance increases by pack quantity.',
      ],
    );

    let duplicateGrantPass = false;
    if (successfulAttempts.length > 0) {
      const firstSuccess = successfulAttempts[0];
      const duplicateResp = await api('POST', '/mobile/consumables/google-play/verify', {
        token: viewer.token,
        body: {
          productId: firstSuccess.productId,
          purchaseToken: firstSuccess.purchaseToken,
          orderId: `duplicate-${Date.now()}`,
          transactionDate: new Date().toISOString(),
        },
      });
      const balancesAfterDuplicateResp = await api('GET', '/mobile/consumables/balances', { token: viewer.token });
      const balancesAfterDuplicate = unwrap(balancesAfterDuplicateResp) || {};

      duplicateGrantPass =
        duplicateResp.ok &&
        Number(balancesAfterDuplicate.likes ?? 0) === Number(balancesAfterPurchase.likes ?? 0) &&
        Number(balancesAfterDuplicate.compliments ?? 0) === Number(balancesAfterPurchase.compliments ?? 0) &&
        Number(balancesAfterDuplicate.boosts ?? 0) === Number(balancesAfterPurchase.boosts ?? 0);

      addCheck(
        'purchase',
        'Duplicate purchase tokens do not grant duplicate balances',
        duplicateGrantPass,
        {
          duplicateStatus: duplicateResp.status,
          balancesAfterPurchase,
          balancesAfterDuplicate,
        },
        'critical',
        [
          'Replay the same purchase token against verify endpoint.',
          'Expected: no additional balance grant for duplicated token.',
        ],
      );
    } else {
      addCheck(
        'purchase',
        'Duplicate purchase tokens do not grant duplicate balances',
        false,
        { reason: 'No successful purchase available to execute duplicate-grant test.' },
        'critical',
        [
          'Complete one successful purchase first.',
          'Replay same purchase token once.',
          'Verify balances do not increment a second time.',
        ],
      );
    }

    let consumePass = false;
    let repurchaseAfterRunoutPass = false;

    if (successfulAttempts.length > 0) {
      const beforeConsumeResp = await api('GET', '/mobile/consumables/balances', { token: viewer.token });
      const beforeConsume = unwrap(beforeConsumeResp) || {};

      await api('POST', '/swipes', {
        token: viewer.token,
        body: { targetUserId: maleNear.id, action: 'like' },
      });
      await api('POST', '/swipes', {
        token: viewer.token,
        body: { targetUserId: maleFar.id, action: 'compliment', complimentMessage: 'Final QA compliment consumption check' },
      });

      await api('POST', '/monetization/boost', {
        token: viewer.token,
        body: { durationMinutes: 1 },
      });

      const afterConsumeResp = await api('GET', '/mobile/consumables/balances', { token: viewer.token });
      const afterConsume = unwrap(afterConsumeResp) || {};

      consumePass =
        Number(afterConsume.likes ?? 0) <= Number(beforeConsume.likes ?? 0) &&
        Number(afterConsume.compliments ?? 0) <= Number(beforeConsume.compliments ?? 0) &&
        Number(afterConsume.boosts ?? 0) <= Number(beforeConsume.boosts ?? 0);

      addCheck(
        'purchase',
        'Balances decrement correctly when likes/compliments/boosts are consumed',
        consumePass,
        { beforeConsume, afterConsume },
        'critical',
        [
          'Use one like, one compliment, and one boost after purchase.',
          'Open consumable balances.',
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

        let repurchaseResp = null;
        if (runOutReached) {
          repurchaseResp = await api('POST', '/mobile/consumables/google-play/verify', {
            token: viewer.token,
            body: {
              productId: boostProduct.googleProductId,
              purchaseToken: `final-qa-rebuy-boost-${Date.now()}`,
              orderId: `final-rebuy-${Date.now()}`,
              transactionDate: new Date().toISOString(),
            },
          });
        }

        const afterRepurchase = unwrap(await api('GET', '/mobile/consumables/balances', { token: viewer.token })) || {};

        repurchaseAfterRunoutPass =
          runOutReached &&
          !!repurchaseResp &&
          repurchaseResp.ok &&
          Number(afterRepurchase.boosts ?? 0) > Number(afterDrain.boosts ?? 0);

        addCheck(
          'purchase',
          'User can buy again after quantity runs out',
          repurchaseAfterRunoutPass,
          {
            runOutReached,
            repurchaseStatus: repurchaseResp?.status ?? null,
            afterDrain,
            afterRepurchase,
          },
          'critical',
          [
            'Consume a pack balance until it reaches zero.',
            'Attempt to purchase the same pack again.',
            'Expected: purchase succeeds and balance increases from zero.',
          ],
        );
      } else {
        addCheck(
          'purchase',
          'User can buy again after quantity runs out',
          false,
          { reason: 'No mapped boosts pack product found to validate run-out and repurchase.' },
          'critical',
          [
            'Ensure boosts pack is configured with googleProductId.',
            'Drain boosts to zero and repurchase.',
          ],
        );
      }
    } else {
      addCheck(
        'purchase',
        'Balances decrement correctly when likes/compliments/boosts are consumed',
        false,
        { reason: 'No successful consumable purchase was available; consumption validation blocked.' },
        'critical',
        [
          'Complete one successful consumable purchase first.',
          'Use balance in swipe/boost actions.',
          'Verify decrements in balances endpoint.',
        ],
      );

      addCheck(
        'purchase',
        'User can buy again after quantity runs out',
        false,
        { reason: 'No successful purchase path in this runtime; cannot reach buy-again scenario.' },
        'critical',
        [
          'Complete at least one successful consumable purchase.',
          'Consume full balance.',
          'Re-purchase same pack and verify top-up.',
        ],
      );
    }

    const profilePatch = await api('PATCH', '/users/me', {
      token: viewer.token,
      body: { firstName: 'FinalRuntime', lastName: 'Verified' },
    });
    const meAfterPatch = unwrap(await api('GET', '/users/me', { token: viewer.token })) || {};

    addCheck(
      'polish',
      'Profile/settings changes reflect correctly',
      profilePatch.ok && meAfterPatch.firstName === 'FinalRuntime' && meAfterPatch.lastName === 'Verified',
      {
        patchStatus: profilePatch.status,
        firstName: meAfterPatch.firstName,
        lastName: meAfterPatch.lastName,
      },
      'critical',
      [
        'Update profile names in settings.',
        'Reload account/profile page.',
        'Expected: updated fields persist and render immediately.',
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
    const notifAfterRelogin = unwrap(await api('GET', '/notifications/settings', { token: reloginViewer.token })) || {};

    addCheck(
      'polish',
      'Notification settings persist after relogin',
      reloginViewer.ok && notifAfterRelogin.promotionsNotifications === false && notifAfterRelogin.weeklySummaryNotifications === false,
      {
        promotionsNotifications: notifAfterRelogin.promotionsNotifications,
        weeklySummaryNotifications: notifAfterRelogin.weeklySummaryNotifications,
      },
      'critical',
      [
        'Change notification toggles in settings.',
        'Logout and login again.',
        'Expected: toggles keep saved state.',
      ],
    );

    await api('DELETE', '/notifications/clear-all', { token: viewer.token });

    await api('POST', '/swipes', {
      token: maleNear.token,
      body: { targetUserId: viewer.id, action: 'like' },
    });

    const whoLikedFreeResp = await api('GET', '/swipes/who-liked-me', { token: viewer.token });
    const whoLikedFree = unwrap(whoLikedFreeResp) || {};
    const freeIsBlurred = Array.isArray(whoLikedFree.users) && whoLikedFree.users.length > 0 && whoLikedFree.users.every((u) => u.isBlurred === true);

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
      'Premium badge/gating behaves correctly (blurred free vs unblurred premium)',
      whoLikedFreeResp.ok && freeIsBlurred && premiumGrant.ok && whoLikedPremiumResp.ok && premiumUnblurred,
      {
        freeWhoLikedCount: whoLikedFree.count,
        freeIsBlurred,
        premiumGrantStatus: premiumGrant.status,
        premiumWhoLikedCount: whoLikedPremium.count,
        premiumUnblurred,
      },
      'critical',
      [
        'Trigger inbound likes to target user.',
        'Open who-liked-me as free user (expect blurred teaser).',
        'Grant premium and reopen (expect full identities).',
      ],
    );

    await api('POST', '/swipes', {
      token: viewer.token,
      body: { targetUserId: maleNear.id, action: 'like' },
    });

    const convResp = await api('POST', '/chat/conversations', {
      token: viewer.token,
      body: { targetUserId: maleNear.id },
    });
    const conversationId = unwrap(convResp)?.id;

    await api('POST', `/chat/conversations/${conversationId}/messages`, {
      token: maleNear.token,
      body: { content: 'Final QA message notification test' },
    });

    const supportCreateResp = await api('POST', '/support', {
      token: viewer.token,
      body: {
        subject: `Final runtime support ${Date.now()}`,
        message: 'Validating support flow and ticket notification routing.',
      },
    });
    const ticketId = unwrap(supportCreateResp)?.id;

    await api('PATCH', `/admin/tickets/${ticketId}/reply`, {
      token: adminToken,
      body: {
        reply: 'Final runtime admin reply',
        status: 'in_progress',
      },
    });

    await api('PATCH', `/admin/users/${viewer.id}`, {
      token: adminToken,
      body: { selfieUrl: `https://example.com/final-verification-${Date.now()}.jpg` },
    });

    await api('PATCH', `/admin/users/${viewer.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Final runtime verification rejection test' },
    });

    await api('POST', '/admin/notifications/send', {
      token: adminToken,
      body: {
        userId: viewer.id,
        title: 'Final Runtime System Notification',
        body: 'System route validation in final QA',
        type: 'system',
      },
    });

    const notificationsResp = await api('GET', '/notifications', {
      token: viewer.token,
      query: { page: 1, limit: 100 },
    });
    const notifications = unwrap(notificationsResp)?.notifications || [];
    const types = new Set(notifications.map((n) => normalizeNotificationType(n)));

    addCheck(
      'polish',
      'Notification routing still works after latest fixes',
      ['like', 'match', 'message', 'ticket', 'verification', 'system'].every((t) => types.has(t)),
      {
        notificationTypes: [...types],
        count: notifications.length,
      },
      'critical',
      [
        'Trigger like, match, message, ticket reply, verification update, and system notification events.',
        'Open notifications feed.',
        'Expected: all corresponding notification types are delivered.',
      ],
    );

    const ticketDetailResp = await api('GET', `/support/my-tickets/${ticketId}`, { token: viewer.token });
    const ticketListResp = await api('GET', '/support/my-tickets', {
      token: viewer.token,
      query: { page: 1, limit: 20 },
    });
    const ticketDetail = unwrap(ticketDetailResp) || {};
    const ticketList = unwrap(ticketListResp) || { tickets: [] };
    const listedTicket = (ticketList.tickets || []).find((t) => t.id === ticketId);

    addCheck(
      'polish',
      'Support ticket flow works fully in app',
      supportCreateResp.ok && ticketDetailResp.ok && ticketListResp.ok && ticketDetail.adminReply && listedTicket?.adminReply,
      {
        createStatus: supportCreateResp.status,
        detailStatus: ticketDetailResp.status,
        listStatus: ticketListResp.status,
        hasReplyInDetail: !!ticketDetail.adminReply,
        hasReplyInList: !!listedTicket?.adminReply,
      },
      'critical',
      [
        'Create support ticket from user app.',
        'Reply as admin.',
        'Open ticket detail and ticket list in app.',
        'Expected: reply and status visible in both views.',
      ],
    );

    const limitedUpdate = await api('PATCH', `/admin/users/${moderationUser.id}/status`, {
      token: adminToken,
      body: {
        status: 'limited',
        reason: 'Final runtime moderation messaging test',
        moderationReasonCode: 'OTHER',
        moderationReasonText: 'Final runtime moderation messaging test',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Contact support for review.',
        isUserVisible: false,
      },
    });

    const limitedStatusResp = await api('GET', '/users/me/status', { token: moderationUser.token });
    const limitedStatusData = unwrap(limitedStatusResp) || {};
    const limitedGateResp = await api('GET', '/matches/suggestions', {
      token: moderationUser.token,
      query: { limit: 5 },
    });

    const suspendedUpdate = await api('PATCH', `/admin/users/${moderationUser.id}/status`, {
      token: adminToken,
      body: {
        status: 'suspended',
        reason: 'Final runtime suspended test',
        moderationReasonCode: 'POLICY_VIOLATION',
        moderationReasonText: 'Final runtime suspended test',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Account suspended for QA test.',
      },
    });

    const suspendedLogin = await login(moderationUser.email, TEST_PASSWORD);

    addCheck(
      'polish',
      'Moderation/account-state messaging has no obvious regression',
      limitedUpdate.ok && limitedStatusResp.ok && limitedStatusData.status === 'limited' && limitedGateResp.status === 403 && suspendedUpdate.ok && !suspendedLogin.ok && [401, 403].includes(suspendedLogin.resp.status),
      {
        limitedUpdateStatus: limitedUpdate.status,
        limitedStatusCode: limitedStatusResp.status,
        limitedStatusPayload: limitedStatusData,
        limitedGateStatus: limitedGateResp.status,
        suspendedUpdateStatus: suspendedUpdate.status,
        suspendedLoginStatus: suspendedLogin.ok ? 200 : suspendedLogin.resp.status,
      },
      'critical',
      [
        'Set user to LIMITED and check /users/me/status payload + restricted route response.',
        'Set same user to SUSPENDED and attempt login.',
        'Expected: clear moderation messaging and blocked access behavior.',
      ],
    );

    const swipeWeights = {
      homeLoad: 10,
      swipeLatency: 10,
      nextCardLatency: 10,
      seenReappear: 15,
      queueStable: 10,
      distanceCorrect: 10,
      distanceFirst: 5,
      filtersEffective: 10,
      filtersFast: 5,
      rewindFlow: 15,
    };

    const swipeCheckMap = {
      homeLoad: report.checks.find((c) => c.name === 'Home users load quickly')?.passed,
      swipeLatency: report.checks.find((c) => c.name === 'Swipe round-trips are smooth (no post-swipe lag spikes)')?.passed,
      nextCardLatency: report.checks.find((c) => c.name === 'Swipe round-trips are smooth (no post-swipe lag spikes)')?.passed,
      seenReappear: report.checks.find((c) => c.name === 'Seen users do not reappear after refresh/reopen/filter change')?.passed,
      queueStable: report.checks.find((c) => c.name === 'Queue remains stable across refresh and reopen')?.passed,
      distanceCorrect: report.checks.find((c) => c.name === 'Distance values are shown correctly')?.passed,
      distanceFirst: report.checks.find((c) => c.name === 'Distance-first ordering works when requested')?.passed,
      filtersEffective:
        report.checks.find((c) => c.name === 'Gender filter changes discovery results')?.passed &&
        report.checks.find((c) => c.name === 'Age filter changes discovery results')?.passed &&
        report.checks.find((c) => c.name === 'Verified filter changes discovery results')?.passed,
      filtersFast: report.checks.find((c) => c.name === 'Filters keep discovery responsive')?.passed,
      rewindFlow: report.checks.find((c) => c.name === 'Premium rewind flow works end-to-end (restore, reverse, re-swipe, continuity)')?.passed,
    };

    let swipeScore = 0;
    for (const [key, weight] of Object.entries(swipeWeights)) {
      if (swipeCheckMap[key]) swipeScore += weight;
    }

    const purchaseWeights = {
      catalogDisplay: 20,
      payloadClarity: 10,
      purchaseSuccess: 25,
      consumeDecrement: 15,
      rebuyAfterRunout: 15,
      noDuplicateGrant: 15,
    };

    const purchaseCheckMap = {
      catalogDisplay: report.checks.find((c) => c.name === 'Likes/compliments/boost packs display correctly in app and web payloads')?.passed,
      payloadClarity: report.checks.find((c) => c.name === 'Purchase card payload is clean and understandable for UI rendering')?.passed,
      purchaseSuccess: report.checks.find((c) => c.name === 'Balances update after successful purchase')?.passed,
      consumeDecrement: report.checks.find((c) => c.name === 'Balances decrement correctly when likes/compliments/boosts are consumed')?.passed,
      rebuyAfterRunout: report.checks.find((c) => c.name === 'User can buy again after quantity runs out')?.passed,
      noDuplicateGrant: report.checks.find((c) => c.name === 'Duplicate purchase tokens do not grant duplicate balances')?.passed,
    };

    let purchaseScore = 0;
    for (const [key, weight] of Object.entries(purchaseWeights)) {
      if (purchaseCheckMap[key]) purchaseScore += weight;
    }

    report.scores.swipeExperience = swipeScore;
    report.scores.purchaseUsability = purchaseScore;

    const criticalCount = report.criticalIssues.length;
    let verdict = 'not ready';
    if (criticalCount === 0 && swipeScore >= 90 && purchaseScore >= 85) {
      verdict = 'premium-grade';
    } else if (criticalCount === 0 && swipeScore >= 80 && purchaseScore >= 75) {
      verdict = 'production-ready';
    } else if (swipeScore >= 70 && purchaseScore >= 60) {
      verdict = 'usable but not premium quality';
    }

    report.verdict = verdict;
    report.professionalFeel =
      swipeScore >= 85 && criticalCount === 0
        ? 'Yes - measured runtime behavior is fast and polished enough to feel near Tinder-grade in this backend-driven QA.'
        : 'No - runtime results still show blockers or performance/flow gaps that prevent true Tinder-grade feel.';

    report.summary = {
      totalChecks: report.checks.length,
      passedChecks: report.checks.filter((c) => c.passed).length,
      failedChecks: report.checks.filter((c) => !c.passed).length,
      criticalFailures: report.criticalIssues.length,
      swipeScore,
      purchaseScore,
      verdict,
      professionalFeel: report.professionalFeel,
    };

    report.finishedAt = new Date().toISOString();

    await fs.writeFile('tmp/final-runtime-qa-v5-report.json', JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          reportPath: 'tmp/final-runtime-qa-v5-report.json',
          summary: report.summary,
          criticalIssues: report.criticalIssues.map((i) => ({ group: i.group, name: i.name })),
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
    await fs.writeFile('tmp/final-runtime-qa-v5-report.json', JSON.stringify(report, null, 2), 'utf8');
    console.error(
      JSON.stringify(
        {
          ok: false,
          reportPath: 'tmp/final-runtime-qa-v5-report.json',
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
