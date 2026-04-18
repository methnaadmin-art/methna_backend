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
  return { ok: true, status: resp.status, token: data?.accessToken, user: data?.user };
}

async function createRuntimeUser(adminToken) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `runtime.notif.${stamp}@methna.test`;
  const username = `rt_notif_${Math.floor(Math.random() * 100000)}`;

  const create = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: 'Runtime',
      lastName: 'Notif',
      username,
      status: 'active',
    },
  });

  if (!create.ok) {
    return { ok: false, step: 'create_user', status: create.status, raw: create.json ?? create.text };
  }

  const loginResp = await login(email, TEST_PASSWORD);
  if (!loginResp.ok) {
    return { ok: false, step: 'user_login', status: loginResp.status, raw: loginResp.raw };
  }

  return { ok: true, email, userId: loginResp.user?.id, token: loginResp.token };
}

async function run() {
  const result = {
    group: 'profile_settings_sync_recheck',
    beforeReference: {
      source: 'tmp/runtime-validation-report-v3.json',
      failingCheck: 'Notification settings persist after re-login',
      expectedBefore: {
        promotionsNotifications: true,
        weeklySummaryNotifications: true,
      },
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

    const beforeRead = await api('GET', '/notifications/settings', { token: runtimeUser.token });
    const beforeData = unwrap(beforeRead);
    result.steps.push({
      name: 'initial_settings_read',
      ok: beforeRead.ok,
      status: beforeRead.status,
      promotionsNotifications: beforeData?.promotionsNotifications,
      weeklySummaryNotifications: beforeData?.weeklySummaryNotifications,
    });

    const update = await api('PATCH', '/notifications/settings', {
      token: runtimeUser.token,
      body: {
        promotionsNotifications: false,
        weeklySummaryNotifications: false,
      },
    });
    result.steps.push({ name: 'settings_update', ok: update.ok, status: update.status });
    if (!update.ok) {
      result.error = { step: 'settings_update', raw: update.json ?? update.text };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const relogin = await login(runtimeUser.email, TEST_PASSWORD);
    result.steps.push({ name: 'relogin', ok: relogin.ok, status: relogin.status });
    if (!relogin.ok) {
      result.error = { step: 'relogin', raw: relogin.raw };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const afterRead = await api('GET', '/notifications/settings', { token: relogin.token });
    const afterData = unwrap(afterRead);
    const pass =
      afterRead.ok &&
      afterData?.promotionsNotifications === false &&
      afterData?.weeklySummaryNotifications === false;

    result.steps.push({
      name: 'post_relogin_settings_read',
      ok: pass,
      status: afterRead.status,
      promotionsNotifications: afterData?.promotionsNotifications,
      weeklySummaryNotifications: afterData?.weeklySummaryNotifications,
    });

    result.after = {
      status: afterRead.status,
      data: afterData,
    };
    result.passed = pass;

    console.log(JSON.stringify(result, null, 2));
    if (!pass) {
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
