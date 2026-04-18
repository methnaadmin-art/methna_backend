import fs from 'node:fs/promises';

const baseUrl = 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = 'admin@methna.app';
const ADMIN_PASSWORD = 'Admin@123456';
const TEST_PASSWORD = 'Qa@123456!';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrap(resp) {
  if (!resp || !resp.json) return null;
  return Object.prototype.hasOwnProperty.call(resp.json, 'data') ? resp.json.data : resp.json;
}

async function api(method, path, { token, body, timeoutMs } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 30000);

  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

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
    json,
    text,
  };
}

async function login(email, password) {
  const resp = await api('POST', '/auth/login', {
    body: { email, password },
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, raw: resp.json || resp.text };
  }

  const data = unwrap(resp);
  return {
    ok: true,
    token: data && data.accessToken,
    user: data && data.user,
  };
}

async function createRuntimeUser(adminToken, label) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `runtime.consumable.${label}.${stamp}@methna.test`;
  const username = `rt_cons_${label}_${Math.floor(Math.random() * 100000)}`;

  const created = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: `Runtime${label}`,
      lastName: 'Consumable',
      username,
      status: 'active',
    },
  });

  if (!created.ok) {
    throw new Error(`Create user failed (${label}): ${created.status} ${created.text}`);
  }

  const auth = await login(email, TEST_PASSWORD);
  if (!auth.ok) {
    throw new Error(`Login failed (${label}): ${auth.status} ${JSON.stringify(auth.raw)}`);
  }

  const profileResp = await api('POST', '/profiles', {
    token: auth.token,
    body: {
      bio: 'Runtime consumable balance verification profile.',
      gender: 'female',
      dateOfBirth: '1995-03-12',
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
      aboutPartner: 'Runtime profile for consumable verification.',
      city: 'RuntimeCity',
      country: 'RuntimeCountry',
    },
  });

  if (!profileResp.ok && profileResp.status !== 409) {
    throw new Error(`Create profile failed (${label}): ${profileResp.status} ${profileResp.text}`);
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
    throw new Error(`Set location failed (${label}): ${locationResp.status} ${locationResp.text}`);
  }

  return {
    id: auth.user && auth.user.id,
    email,
    token: auth.token,
  };
}

async function createTargetUsers(adminToken, count, labelPrefix) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}_${i}`;
    const email = `runtime.target.${labelPrefix}.${stamp}@methna.test`;
    const username = `rt_target_${labelPrefix}_${Math.floor(Math.random() * 100000)}_${i}`;

    const created = await api('POST', '/admin/users', {
      token: adminToken,
      body: {
        email,
        password: TEST_PASSWORD,
        firstName: 'Target',
        lastName: `${labelPrefix}${i}`,
        username,
        status: 'active',
      },
    });

    if (!created.ok) {
      throw new Error(`Create target user failed (${i}): ${created.status} ${created.text}`);
    }

    const createdData = unwrap(created);
    if (!createdData || !createdData.id) {
      throw new Error(`Create target user returned no id (${i})`);
    }

    ids.push(createdData.id);
  }
  return ids;
}

async function swipeWithRetry(userToken, payload) {
  const maxAttempts = 8;
  let lastResp = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const resp = await api('POST', '/swipes', {
      token: userToken,
      body: payload,
      timeoutMs: 45000,
    });

    lastResp = resp;

    if (resp.status !== 429) {
      return resp;
    }

    const delay = 1500 * attempt;
    await sleep(delay);
  }

  return lastResp;
}

async function getConsumableBalances(userToken) {
  const resp = await api('GET', '/mobile/consumables/balances', { token: userToken });
  if (!resp.ok) {
    throw new Error(`Get balances failed: ${resp.status} ${resp.text}`);
  }
  const data = unwrap(resp) || {};
  return {
    likes: Number(data.likes || 0),
    compliments: Number(data.compliments || 0),
    boosts: Number(data.boosts || 0),
  };
}

async function getDailyLikeRemaining(userToken) {
  const resp = await api('GET', '/monetization/remaining-likes', { token: userToken });
  if (!resp.ok) {
    throw new Error(`Get remaining likes failed: ${resp.status} ${resp.text}`);
  }
  const data = unwrap(resp) || {};
  const totalRemaining = Number(data.remaining);
  const consumableBalance = Number(data.consumableBalance || 0);
  if (Number.isNaN(totalRemaining)) {
    return { isUnlimited: false, dailyRemaining: 0, raw: data };
  }

  if (totalRemaining === -1 || data.isUnlimited === true) {
    return { isUnlimited: true, dailyRemaining: Number.POSITIVE_INFINITY, raw: data };
  }

  const dailyRemaining = Math.max(0, totalRemaining - consumableBalance);
  return { isUnlimited: false, dailyRemaining, raw: data };
}

async function resetBalancesToZero(adminToken, userId) {
  const currentResp = await api('GET', `/consumables/admin/users/${userId}/balances`, { token: adminToken });
  if (!currentResp.ok) {
    throw new Error(`Admin get balances failed: ${currentResp.status} ${currentResp.text}`);
  }
  const current = unwrap(currentResp) || {};

  const entries = [
    { type: 'likes', value: Number(current.likes || 0) },
    { type: 'compliments', value: Number(current.compliments || 0) },
    { type: 'boosts', value: Number(current.boosts || 0) },
  ];

  for (const entry of entries) {
    if (entry.value <= 0) continue;
    const adjustResp = await api('POST', `/consumables/admin/users/${userId}/balances/adjust`, {
      token: adminToken,
      body: {
        type: entry.type,
        delta: -entry.value,
        reason: 'Runtime consumable flow baseline reset',
      },
    });

    if (!adjustResp.ok) {
      throw new Error(
        `Reset ${entry.type} balance failed: ${adjustResp.status} ${adjustResp.text}`,
      );
    }
  }
}

async function purchaseConsumable(userToken, product, marker) {
  const purchaseToken = `qa-${marker}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const orderId = `order-${purchaseToken}`;
  return api('POST', '/mobile/consumables/google-play/verify', {
    token: userToken,
    body: {
      productId: product.googleProductId,
      purchaseToken,
      orderId,
      transactionDate: new Date().toISOString(),
    },
  });
}

function consumeResult(success, details) {
  return {
    success,
    details,
  };
}

async function consumeLikes(userToken, targets, state, count) {
  for (let i = 0; i < count; i += 1) {
    if (state.cursor >= targets.length) {
      return consumeResult(false, {
        step: 'consume_likes',
        reason: 'Not enough target users',
        consumed: i,
      });
    }

    const targetUserId = targets[state.cursor];
    state.cursor += 1;

    const resp = await swipeWithRetry(userToken, {
      targetUserId,
      action: 'like',
    });

    if (!resp.ok) {
      return consumeResult(false, {
        step: 'consume_likes',
        index: i,
        targetUserId,
        status: resp.status,
        raw: resp.json || resp.text,
      });
    }
  }

  return consumeResult(true, { consumed: count });
}

async function consumeCompliments(userToken, targets, state, count) {
  for (let i = 0; i < count; i += 1) {
    if (state.cursor >= targets.length) {
      return consumeResult(false, {
        step: 'consume_compliments',
        reason: 'Not enough target users',
        consumed: i,
      });
    }

    const targetUserId = targets[state.cursor];
    state.cursor += 1;

    const resp = await swipeWithRetry(userToken, {
      targetUserId,
      action: 'compliment',
      complimentMessage: `Runtime compliment ${Date.now()}-${i}`,
    });

    if (!resp.ok) {
      return consumeResult(false, {
        step: 'consume_compliments',
        index: i,
        targetUserId,
        status: resp.status,
        raw: resp.json || resp.text,
      });
    }
  }

  return consumeResult(true, { consumed: count });
}

async function waitUntilBoostInactive(userToken, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const resp = await api('GET', '/monetization/boost', { token: userToken });
    if (resp.ok) {
      const data = unwrap(resp) || {};
      if (!data.isActive) {
        return true;
      }
    }
    await sleep(250);
  }
  return false;
}

async function consumeBoosts(userToken, count) {
  for (let i = 0; i < count; i += 1) {
    const activate = await api('POST', '/monetization/boost', {
      token: userToken,
      body: { durationMinutes: 0.02 },
      timeoutMs: 45000,
    });

    if (!activate.ok) {
      return consumeResult(false, {
        step: 'consume_boosts',
        index: i,
        status: activate.status,
        raw: activate.json || activate.text,
      });
    }

    const becameInactive = await waitUntilBoostInactive(userToken, 15000);
    if (!becameInactive) {
      return consumeResult(false, {
        step: 'consume_boosts',
        index: i,
        reason: 'Boost did not expire quickly enough during test run',
      });
    }
  }

  return consumeResult(true, { consumed: count });
}

function pickCheapestByQuantity(products, type) {
  const list = (products || [])
    .filter((p) => p && p.type === type && p.googleProductId)
    .sort((a, b) => {
      if (a.quantity !== b.quantity) return a.quantity - b.quantity;
      return Number(a.price || 0) - Number(b.price || 0);
    });
  return list[0] || null;
}

async function run() {
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    user: null,
    products: {},
    results: {
      likes: {},
      compliments: {},
      boosts: {},
    },
    blockers: [],
    summary: {},
  };

  try {
    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!adminLogin.ok) {
      throw new Error(`Admin login failed: ${adminLogin.status} ${JSON.stringify(adminLogin.raw)}`);
    }

    const runtimeUser = await createRuntimeUser(adminLogin.token, 'consumer');
    report.user = { id: runtimeUser.id, email: runtimeUser.email };

    await resetBalancesToZero(adminLogin.token, runtimeUser.id);

    const productsResp = await api('GET', '/mobile/consumables');
    if (!productsResp.ok) {
      throw new Error(`Get mobile consumables failed: ${productsResp.status} ${productsResp.text}`);
    }

    const products = unwrap(productsResp) || [];
    const likesProduct = pickCheapestByQuantity(products, 'likes_pack');
    const complimentsProduct = pickCheapestByQuantity(products, 'compliments_pack');
    const boostsProduct = pickCheapestByQuantity(products, 'boosts_pack');

    report.products = {
      likes: likesProduct,
      compliments: complimentsProduct,
      boosts: boostsProduct,
    };

    if (!likesProduct) report.blockers.push('No active mobile likes consumable product mapped with googleProductId.');
    if (!complimentsProduct) report.blockers.push('No active mobile compliments consumable product mapped with googleProductId.');
    if (!boostsProduct) report.blockers.push('No active mobile boosts consumable product mapped with googleProductId.');

    const likeDailyInfo = await getDailyLikeRemaining(runtimeUser.token);
    let predrainLikesCount = likeDailyInfo.dailyRemaining;
    if (!Number.isFinite(predrainLikesCount)) {
      predrainLikesCount = 0;
      report.blockers.push('Likes daily quota is unlimited for this user; strict blocked-at-zero for likes cannot be proven via fallback limits.');
    }

    const targetsNeeded =
      Math.max(0, predrainLikesCount) +
      (likesProduct ? likesProduct.quantity + 3 : 0) +
      (complimentsProduct ? complimentsProduct.quantity + 3 : 0) +
      5;

    const targets = await createTargetUsers(adminLogin.token, Math.max(20, targetsNeeded), 'consumable');
    const targetState = { cursor: 0 };

    // --- LIKES FLOW ---
    if (likesProduct) {
      const likesResult = {
        worksNormallyInAccount: false,
        rebuyAfterRunoutWorks: false,
        checks: {},
      };

      const beforePurchase = await getConsumableBalances(runtimeUser.token);

      if (predrainLikesCount > 0 && Number.isFinite(predrainLikesCount)) {
        const predrain = await consumeLikes(runtimeUser.token, targets, targetState, predrainLikesCount);
        likesResult.checks.predrainDailyLikes = predrain;
      } else {
        likesResult.checks.predrainDailyLikes = consumeResult(true, {
          consumed: 0,
          note: 'No finite daily likes to pre-drain.',
        });
      }

      const purchase1 = await purchaseConsumable(runtimeUser.token, likesProduct, 'likes-first');
      const afterPurchase = await getConsumableBalances(runtimeUser.token);
      likesResult.checks.purchaseIncreaseImmediate = {
        success:
          purchase1.ok &&
          afterPurchase.likes - beforePurchase.likes === Number(likesProduct.quantity),
        details: {
          status: purchase1.status,
          beforeLikes: beforePurchase.likes,
          afterLikes: afterPurchase.likes,
          expectedIncrease: Number(likesProduct.quantity),
          raw: purchase1.ok ? undefined : (purchase1.json || purchase1.text),
        },
      };

      const consumePack = await consumeLikes(
        runtimeUser.token,
        targets,
        targetState,
        Number(likesProduct.quantity),
      );
      const afterConsume = await getConsumableBalances(runtimeUser.token);

      likesResult.checks.consumeDecreasesBalance = {
        success: consumePack.success && afterConsume.likes === 0,
        details: {
          consumePack,
          afterConsumeLikes: afterConsume.likes,
        },
      };

      const extraLikeTarget = targets[targetState.cursor];
      targetState.cursor += 1;
      const extraLikeResp = extraLikeTarget
        ? await swipeWithRetry(runtimeUser.token, { targetUserId: extraLikeTarget, action: 'like' })
        : { ok: false, status: -1, json: { error: 'no_target' }, text: 'no_target' };

      likesResult.checks.blockedAtZero = {
        success: !extraLikeResp.ok,
        details: {
          status: extraLikeResp.status,
          raw: extraLikeResp.json || extraLikeResp.text,
        },
      };

      const purchase2 = await purchaseConsumable(runtimeUser.token, likesProduct, 'likes-second');
      const afterRebuy = await getConsumableBalances(runtimeUser.token);

      likesResult.checks.rebuyIncrease = {
        success:
          purchase2.ok &&
          afterRebuy.likes === Number(likesProduct.quantity),
        details: {
          status: purchase2.status,
          afterRebuyLikes: afterRebuy.likes,
          expectedAfterRebuy: Number(likesProduct.quantity),
          raw: purchase2.ok ? undefined : (purchase2.json || purchase2.text),
        },
      };

      likesResult.worksNormallyInAccount =
        likesResult.checks.purchaseIncreaseImmediate.success &&
        likesResult.checks.consumeDecreasesBalance.success &&
        likesResult.checks.blockedAtZero.success;

      likesResult.rebuyAfterRunoutWorks = likesResult.checks.rebuyIncrease.success;
      report.results.likes = likesResult;
    }

    // --- COMPLIMENTS FLOW ---
    if (complimentsProduct) {
      const complimentsResult = {
        worksNormallyInAccount: false,
        rebuyAfterRunoutWorks: false,
        checks: {},
      };

      const beforePurchase = await getConsumableBalances(runtimeUser.token);
      const purchase1 = await purchaseConsumable(runtimeUser.token, complimentsProduct, 'compliments-first');
      const afterPurchase = await getConsumableBalances(runtimeUser.token);

      complimentsResult.checks.purchaseIncreaseImmediate = {
        success:
          purchase1.ok &&
          afterPurchase.compliments - beforePurchase.compliments === Number(complimentsProduct.quantity),
        details: {
          status: purchase1.status,
          beforeCompliments: beforePurchase.compliments,
          afterCompliments: afterPurchase.compliments,
          expectedIncrease: Number(complimentsProduct.quantity),
          raw: purchase1.ok ? undefined : (purchase1.json || purchase1.text),
        },
      };

      const consumePack = await consumeCompliments(
        runtimeUser.token,
        targets,
        targetState,
        Number(complimentsProduct.quantity),
      );
      const afterConsume = await getConsumableBalances(runtimeUser.token);

      complimentsResult.checks.consumeDecreasesBalance = {
        success: consumePack.success && afterConsume.compliments === 0,
        details: {
          consumePack,
          afterConsumeCompliments: afterConsume.compliments,
        },
      };

      const extraComplimentTarget = targets[targetState.cursor];
      targetState.cursor += 1;
      const extraComplimentResp = extraComplimentTarget
        ? await swipeWithRetry(runtimeUser.token, {
            targetUserId: extraComplimentTarget,
            action: 'compliment',
            complimentMessage: `Extra compliment ${Date.now()}`,
          })
        : { ok: false, status: -1, json: { error: 'no_target' }, text: 'no_target' };

      complimentsResult.checks.blockedAtZero = {
        success: !extraComplimentResp.ok,
        details: {
          status: extraComplimentResp.status,
          raw: extraComplimentResp.json || extraComplimentResp.text,
        },
      };

      const purchase2 = await purchaseConsumable(runtimeUser.token, complimentsProduct, 'compliments-second');
      const afterRebuy = await getConsumableBalances(runtimeUser.token);

      complimentsResult.checks.rebuyIncrease = {
        success:
          purchase2.ok &&
          afterRebuy.compliments === Number(complimentsProduct.quantity),
        details: {
          status: purchase2.status,
          afterRebuyCompliments: afterRebuy.compliments,
          expectedAfterRebuy: Number(complimentsProduct.quantity),
          raw: purchase2.ok ? undefined : (purchase2.json || purchase2.text),
        },
      };

      complimentsResult.worksNormallyInAccount =
        complimentsResult.checks.purchaseIncreaseImmediate.success &&
        complimentsResult.checks.consumeDecreasesBalance.success &&
        complimentsResult.checks.blockedAtZero.success;

      complimentsResult.rebuyAfterRunoutWorks = complimentsResult.checks.rebuyIncrease.success;
      report.results.compliments = complimentsResult;
    }

    // --- BOOSTS FLOW ---
    if (boostsProduct) {
      const boostsResult = {
        worksNormallyInAccount: false,
        rebuyAfterRunoutWorks: false,
        checks: {},
      };

      const beforePurchase = await getConsumableBalances(runtimeUser.token);
      const purchase1 = await purchaseConsumable(runtimeUser.token, boostsProduct, 'boosts-first');
      const afterPurchase = await getConsumableBalances(runtimeUser.token);

      boostsResult.checks.purchaseIncreaseImmediate = {
        success:
          purchase1.ok &&
          afterPurchase.boosts - beforePurchase.boosts === Number(boostsProduct.quantity),
        details: {
          status: purchase1.status,
          beforeBoosts: beforePurchase.boosts,
          afterBoosts: afterPurchase.boosts,
          expectedIncrease: Number(boostsProduct.quantity),
          raw: purchase1.ok ? undefined : (purchase1.json || purchase1.text),
        },
      };

      const consumePack = await consumeBoosts(runtimeUser.token, Number(boostsProduct.quantity));
      const afterConsume = await getConsumableBalances(runtimeUser.token);

      boostsResult.checks.consumeDecreasesBalance = {
        success: consumePack.success && afterConsume.boosts === 0,
        details: {
          consumePack,
          afterConsumeBoosts: afterConsume.boosts,
        },
      };

      const readyForExtra = await waitUntilBoostInactive(runtimeUser.token, 15000);
      const extraBoostResp = readyForExtra
        ? await api('POST', '/monetization/boost', {
            token: runtimeUser.token,
            body: { durationMinutes: 0.02 },
            timeoutMs: 45000,
          })
        : { ok: false, status: -1, json: { error: 'boost_still_active' }, text: 'boost_still_active' };

      boostsResult.checks.blockedAtZero = {
        success: !extraBoostResp.ok,
        details: {
          status: extraBoostResp.status,
          raw: extraBoostResp.json || extraBoostResp.text,
        },
      };

      const purchase2 = await purchaseConsumable(runtimeUser.token, boostsProduct, 'boosts-second');
      const afterRebuy = await getConsumableBalances(runtimeUser.token);

      boostsResult.checks.rebuyIncrease = {
        success:
          purchase2.ok &&
          afterRebuy.boosts === Number(boostsProduct.quantity),
        details: {
          status: purchase2.status,
          afterRebuyBoosts: afterRebuy.boosts,
          expectedAfterRebuy: Number(boostsProduct.quantity),
          raw: purchase2.ok ? undefined : (purchase2.json || purchase2.text),
        },
      };

      boostsResult.worksNormallyInAccount =
        boostsResult.checks.purchaseIncreaseImmediate.success &&
        boostsResult.checks.consumeDecreasesBalance.success &&
        boostsResult.checks.blockedAtZero.success;

      boostsResult.rebuyAfterRunoutWorks = boostsResult.checks.rebuyIncrease.success;
      report.results.boosts = boostsResult;
    }

    report.summary = {
      consumablesWorkNormally: {
        likes: report.results.likes.worksNormallyInAccount === true,
        compliments: report.results.compliments.worksNormallyInAccount === true,
        boosts: report.results.boosts.worksNormallyInAccount === true,
      },
      rebuyAfterRunout: {
        likes: report.results.likes.rebuyAfterRunoutWorks === true,
        compliments: report.results.compliments.rebuyAfterRunoutWorks === true,
        boosts: report.results.boosts.rebuyAfterRunoutWorks === true,
      },
      blockers: report.blockers,
    };
  } catch (error) {
    report.error = {
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : null,
    };
  } finally {
    report.finishedAt = new Date().toISOString();
  }

  await fs.writeFile(
    'tmp/consumable-balance-flow-report.json',
    JSON.stringify(report, null, 2),
    'utf8',
  );

  console.log(JSON.stringify(report, null, 2));

  if (report.error) {
    process.exitCode = 1;
    return;
  }

  const allNormal =
    report.summary.consumablesWorkNormally.likes &&
    report.summary.consumablesWorkNormally.compliments &&
    report.summary.consumablesWorkNormally.boosts;

  const allRebuy =
    report.summary.rebuyAfterRunout.likes &&
    report.summary.rebuyAfterRunout.compliments &&
    report.summary.rebuyAfterRunout.boosts;

  if (!allNormal || !allRebuy || report.summary.blockers.length > 0) {
    process.exitCode = 1;
  }
}

run();
