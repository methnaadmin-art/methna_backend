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
  const email = `runtime.support.${stamp}@methna.test`;
  const username = `rt_support_${Math.floor(Math.random() * 100000)}`;

  const create = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: 'Runtime',
      lastName: 'Support',
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
    token: userLogin.token,
    userId: userLogin.user?.id,
  };
}

async function run() {
  const result = {
    group: 'support_sync_recheck',
    beforeReference: {
      source: 'tmp/runtime-validation-report-v3.json',
      failingCheck: 'User sees reply and updated ticket status',
      status: 403,
    },
    steps: [],
    passed: false,
  };

  try {
    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    result.steps.push({ name: 'admin_login', ok: adminLogin.ok, status: adminLogin.status });
    if (!adminLogin.ok) {
      result.error = { step: 'admin_login', raw: adminLogin.raw };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const runtimeUser = await createRuntimeUser(adminLogin.token);
    result.steps.push({
      name: 'runtime_user_ready',
      ok: runtimeUser.ok,
      userId: runtimeUser.userId,
      email: runtimeUser.email,
      status: runtimeUser.status,
    });
    if (!runtimeUser.ok) {
      result.error = { step: runtimeUser.step, raw: runtimeUser.raw };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const createTicket = await api('POST', '/support', {
      token: runtimeUser.token,
      body: {
        subject: `Runtime support verification ${Date.now()}`,
        message: 'Verifying support ticket ownership and reply visibility after patch.',
      },
    });
    const createdTicket = unwrap(createTicket);
    const ticketId = createdTicket?.id;
    result.steps.push({ name: 'user_create_ticket', ok: createTicket.ok, status: createTicket.status, ticketId });
    if (!createTicket.ok || !ticketId) {
      result.error = { step: 'user_create_ticket', raw: createTicket.json ?? createTicket.text };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const adminReply = await api('PATCH', `/admin/tickets/${ticketId}/reply`, {
      token: adminLogin.token,
      body: {
        reply: 'Runtime support reply visibility check',
        status: 'in_progress',
      },
    });
    result.steps.push({ name: 'admin_reply_ticket', ok: adminReply.ok, status: adminReply.status });
    if (!adminReply.ok) {
      result.error = { step: 'admin_reply_ticket', raw: adminReply.json ?? adminReply.text };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const detail = await api('GET', `/support/my-tickets/${ticketId}`, { token: runtimeUser.token });
    const detailData = unwrap(detail);
    const detailPass = detail.ok && detailData?.status === 'in_progress' && typeof detailData?.adminReply === 'string' && detailData.adminReply.length > 0;
    result.steps.push({
      name: 'user_read_ticket_detail',
      ok: detailPass,
      status: detail.status,
      ticketStatus: detailData?.status,
      hasAdminReply: !!detailData?.adminReply,
    });

    const list = await api('GET', '/support/my-tickets?page=1&limit=20', { token: runtimeUser.token });
    const listData = unwrap(list);
    const tickets = Array.isArray(listData?.tickets) ? listData.tickets : [];
    const listed = tickets.find((t) => t?.id === ticketId);
    const listPass = list.ok && !!listed && typeof listed.adminReply === 'string' && listed.adminReply.length > 0;
    result.steps.push({
      name: 'user_read_ticket_list_for_mobile',
      ok: listPass,
      status: list.status,
      foundTicket: !!listed,
      hasAdminReply: !!listed?.adminReply,
      total: listData?.total,
    });

    result.passed = detailPass && listPass;
    result.after = {
      detailStatus: detail.status,
      listStatus: list.status,
      replyVisibleInDetail: !!detailData?.adminReply,
      replyVisibleInList: !!listed?.adminReply,
    };

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
