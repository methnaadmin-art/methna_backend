const baseUrl = 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = 'admin@methna.app';
const ADMIN_PASSWORD = 'Admin@123456';
const TEST_PASSWORD = 'Qa@123456!';

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, json, text };
}

function unwrap(resp) {
  if (!resp?.json) return null;
  return Object.prototype.hasOwnProperty.call(resp.json, 'data') ? resp.json.data : resp.json;
}

async function login(email, password) {
  const resp = await api('POST', '/auth/login', { body: { email, password } });
  if (!resp.ok) {
    return { ok: false, status: resp.status, raw: resp.json ?? resp.text };
  }

  const data = unwrap(resp);
  return {
    ok: true,
    status: resp.status,
    token: data?.accessToken,
    user: data?.user,
  };
}

async function createRuntimeUser(adminToken) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `runtime.premium.${stamp}@methna.test`;
  const username = `rt_premium_${Math.floor(Math.random() * 100000)}`;

  const create = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: 'Runtime',
      lastName: 'Premium',
      username,
      status: 'active',
    },
  });

  if (!create.ok) {
    return { ok: false, step: 'create_user', status: create.status, raw: create.json ?? create.text };
  }

  const userLogin = await login(email, TEST_PASSWORD);
  if (!userLogin.ok) {
    return { ok: false, step: 'user_login', status: userLogin.status, raw: userLogin.raw };
  }

  return {
    ok: true,
    email,
    userId: userLogin.user?.id,
    token: userLogin.token,
  };
}

function hasMappingError(payload) {
  const serialized = JSON.stringify(payload || {});
  return /No active consumable product mapped to Google Play ID/i.test(serialized);
}

function containsAllPackTypes(products) {
  const types = new Set((products || []).map((p) => p?.type));
  return types.has('likes_pack') && types.has('compliments_pack') && types.has('boosts_pack');
}

async function run() {
  const result = {
    group: 'premium_consumables_recheck',
    beforeReference: {
      source: 'tmp/runtime-validation-report-v3.json',
      failingChecks: [
        'Consumables catalog available with at least one product',
        'Consumable purchase verification flow executes',
      ],
    },
    steps: [],
    passed: false,
  };

  try {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    result.steps.push({ name: 'admin_login', ok: admin.ok, status: admin.status });
    if (!admin.ok) {
      result.error = { step: 'admin_login', raw: admin.raw };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const runtimeUser = await createRuntimeUser(admin.token);
    result.steps.push({ name: 'runtime_user_ready', ok: runtimeUser.ok, email: runtimeUser.email, userId: runtimeUser.userId });
    if (!runtimeUser.ok) {
      result.error = { step: runtimeUser.step, raw: runtimeUser.raw };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const startDate = new Date();
    const expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const grantPremium = await api('POST', `/admin/users/${runtimeUser.userId}/premium`, {
      token: admin.token,
      body: {
        startDate: startDate.toISOString(),
        expiryDate: expiryDate.toISOString(),
      },
    });
    result.steps.push({ name: 'grant_premium', ok: grantPremium.ok, status: grantPremium.status });

    const mobileSub = await api('GET', '/mobile/subscription/me', { token: runtimeUser.token });
    const mobileSubData = unwrap(mobileSub);
    const mobileSubPass =
      mobileSub.ok &&
      (mobileSubData?.plan || 'free') !== 'free' &&
      ['active', 'past_due', 'trialing'].includes((mobileSubData?.status || '').toLowerCase());
    result.steps.push({
      name: 'mobile_subscription_reflects_premium',
      ok: mobileSubPass,
      status: mobileSub.status,
      plan: mobileSubData?.plan,
      subscriptionStatus: mobileSubData?.status,
    });

    const mobileConsumables = await api('GET', '/mobile/consumables');
    const mobileProducts = unwrap(mobileConsumables) || [];
    const mobileCatalogPass =
      mobileConsumables.ok &&
      Array.isArray(mobileProducts) &&
      mobileProducts.length > 0 &&
      containsAllPackTypes(mobileProducts) &&
      mobileProducts.every((p) => typeof p?.googleProductId === 'string' && p.googleProductId.length > 0);

    result.steps.push({
      name: 'mobile_consumables_catalog_ready',
      ok: mobileCatalogPass,
      status: mobileConsumables.status,
      count: Array.isArray(mobileProducts) ? mobileProducts.length : null,
      products: Array.isArray(mobileProducts)
        ? mobileProducts.map((p) => ({ code: p.code, type: p.type, googleProductId: p.googleProductId }))
        : null,
    });

    const webConsumables = await api('GET', '/consumables/products/web');
    const webProducts = unwrap(webConsumables) || [];
    const webCatalogPass = webConsumables.ok && Array.isArray(webProducts) && webProducts.length > 0;
    result.steps.push({
      name: 'web_consumables_catalog_ready',
      ok: webCatalogPass,
      status: webConsumables.status,
      count: Array.isArray(webProducts) ? webProducts.length : null,
    });

    const mappedProduct = Array.isArray(mobileProducts)
      ? mobileProducts.find((p) => typeof p?.googleProductId === 'string' && p.googleProductId.length > 0)
      : null;

    let verify = null;
    if (mappedProduct) {
      verify = await api('POST', '/mobile/consumables/google-play/verify', {
        token: runtimeUser.token,
        body: {
          productId: mappedProduct.googleProductId,
          purchaseToken: `runtime-token-${Date.now()}`,
          orderId: `runtime-order-${Date.now()}`,
          transactionDate: new Date().toISOString(),
        },
      });
    }

    const verifyPayload = verify?.json ?? verify?.text ?? null;
    const verificationPathUnblocked =
      !!verify &&
      !hasMappingError(verifyPayload) &&
      [200, 400, 401, 422].includes(verify.status);

    result.steps.push({
      name: 'mobile_verify_path_unblocked',
      ok: verificationPathUnblocked,
      mappedProductId: mappedProduct?.googleProductId ?? null,
      status: verify?.status ?? null,
      response: verifyPayload,
    });

    result.after = {
      mobileCatalogCount: Array.isArray(mobileProducts) ? mobileProducts.length : 0,
      webCatalogCount: Array.isArray(webProducts) ? webProducts.length : 0,
      verificationStatus: verify?.status ?? null,
      verificationBlockedByMapping: hasMappingError(verifyPayload),
    };

    result.passed =
      grantPremium.ok &&
      mobileSubPass &&
      mobileCatalogPass &&
      webCatalogPass &&
      verificationPathUnblocked;

    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    result.error = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

run();
